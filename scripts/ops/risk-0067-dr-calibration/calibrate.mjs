#!/usr/bin/env node
// RISK-0067 · CLM-0568 / CLM-0573 · M6-18B — DR-only Supavisor session-pool calibration.
//
// Owner decision 2026-10-15 (plan §12): calibration on the DR project only, read-only
// (`SELECT 1`), derived from S and E measured on the calibration day, explicit stop
// conditions, tagged sessions and verified cleanup. Production load stays prohibited.
//
// Single source of the target guard: `guard()` below. The workflow's guard step runs
// this file with `--guard-only`; the calibration run calls the same function first.
//
//   Target: DR_REPLACEMENT_DB_URL only. No other variable is read and nothing falls back.
//   Accepted: user `postgres.pvyuhjadrygqqdoczmnd` @ `*.pooler.supabase.com` : 5432
//             (Supavisor session mode — the pool under test).
//   Refused: any other ref; the production / retired-production / TEST refs by name
//            anywhere in the URL; direct `db.<ref>.supabase.co` (bypasses Supavisor);
//            port 6543 (transaction mode). Localhost only when RISK0067_SELFTEST=1
//            (a throwaway container in CI; it can never be production or DR).
//
// Derivation (plan §9.4 / §10.3): k_normal = S − E − 2 ; k_neg = S − E + 1.
// Client verdicts (exit code): CLIENT_OK 0 · FAIL 1 · HOLD 3 · guard refusal 2.
// CLIENT_OK is NOT PASS: PASS also needs the EMAXCONNSESSION event in the target
// Supavisor log stream inside the window and full log coverage (read by the executor, §12).
//
// E (CLM-0573). Supavisor's "Pool Size" is per unique (user, database, mode) combination
// (Supabase Supavisor FAQ). pg_stat_activity has no column that tells a session-mode backend
// from a transaction-mode one: both come from the same pooler node, as the same user, into the
// same database. So E is computed by `computeE()` from raw pg_stat_activity rows and counts
// only client backends with the probe's own usename AND datname AND client_addr (pooler node);
// rows of other databases, users, nodes and non-client backends are excluded and reported.
// Because the mode of a matching row cannot be observed, E is accepted ONLY when it is proven
// zero (no matching row at all). Any matching row ⇒ HOLD — never an approximate E.
//
// Time limit (CLM-0573). LIMITS.totalMs (10 min) bounds the whole run from start to the end of
// cleanup. The run phase (preflight, connects, queries, waits, both controls) must end by
// totalMs − cleanupWindowMs; every connect / query / wait is raced against the time left in its
// phase (`bounded()`), and the client is destroyed when its bound expires. The cleanup phase
// has a declared window of cleanupWindowMs (interruptCleanupMs after SIGINT/SIGTERM) and never
// runs past totalMs. A process watchdog exits at totalMs + watchdogGraceMs as a last resort.
// What the tests prove is listed in calibrate.test.mjs; nothing beyond that is claimed.
//
// Never prints the URL, user, password or any secret.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DR_REF = "pvyuhjadrygqqdoczmnd";
export const FORBIDDEN_REFS = {
  ppixaauyqoykrogwdxtv: "production",
  snlpxywskyqrjattbpgn: "retired production",
  obeptvwpvqbduwkahorq: "TEST",
};
export const S_MIN = 3;
export const S_MAX = 500;
export const TAG_PREFIX = "risk0067-calibration-";

/** Declared time limits of a live run (ms). The live run uses these values unchanged. */
export const LIMITS = Object.freeze({
  totalMs: 10 * 60 * 1000, // hard bound: start → end of cleanup
  cleanupWindowMs: 90 * 1000, // reserved at the end of the 10 minutes for cleanup
  interruptCleanupMs: 7 * 1000, // cleanup window after SIGINT/SIGTERM (runner sends SIGTERM ~7.5 s later)
  watchdogGraceMs: 5 * 1000, // process exit if anything is still alive after totalMs
  connectMs: 20 * 1000, // per connect (capped by the time left)
  lastNegConnectMs: 75 * 1000, // session k_neg: session mode may queue ~60 s before refusing
  queryMs: 10 * 1000, // per query (capped by the time left)
  endMs: 5 * 1000, // per client end during cleanup (capped by the cleanup time left)
  holdStepMs: 10 * 1000, // normal control: SELECT 1 interval
  settleMs: 10 * 1000, // pause between the controls
  pollMs: 5 * 1000, // cleanup verification poll interval
});

/** Pure target guard. Returns {ok, reason, ref, hostClass, port}. */
export function guard(url, { selftest = false } = {}) {
  if (!url) return { ok: false, reason: "DR_REPLACEMENT_DB_URL is empty" };
  const lower = url.toLowerCase();
  for (const [ref, label] of Object.entries(FORBIDDEN_REFS)) {
    if (lower.includes(ref)) return { ok: false, reason: `the URL names the ${label} project` };
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not a parseable URL" };
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: "not a postgres URL" };
  const host = u.hostname.toLowerCase();
  const port = u.port ? Number(u.port) : 5432;
  const user = decodeURIComponent(u.username || "");
  if (host === "127.0.0.1" || host === "localhost") {
    return selftest
      ? { ok: true, ref: "selftest-localhost", hostClass: "selftest-localhost", port }
      : { ok: false, reason: "localhost is accepted only in the CI self-test" };
  }
  if (port === 6543) return { ok: false, reason: "transaction pooler (6543) — the session pool is the subject" };
  if (host.startsWith("db.") && host.endsWith(".supabase.co")) {
    return { ok: false, reason: "direct connection bypasses Supavisor — the session pool cannot be measured" };
  }
  if (!host.endsWith(".pooler.supabase.com")) return { ok: false, reason: "host is not a Supabase pooler" };
  if (port !== 5432) return { ok: false, reason: `port ${port} is not the session pooler (5432)` };
  const ref = user.includes(".") ? user.slice(user.lastIndexOf(".") + 1) : null;
  if (ref !== DR_REF) return { ok: false, reason: `project ref is ${JSON.stringify(ref)}, expected the DR project ${DR_REF}` };
  return { ok: true, ref, hostClass: "supavisor-session", port };
}

/** Database user and database the session pool is keyed on, from the target URL. */
export function expectedIdentity(url) {
  const u = new URL(url);
  const login = decodeURIComponent(u.username || "");
  // Supavisor login `postgres.<ref>` reaches Postgres as `postgres`; a dot-less login is used as is.
  const user = login.includes(".") ? login.slice(0, login.lastIndexOf(".")) : login;
  const db = decodeURIComponent(u.pathname.replace(/^\//, "")) || user;
  return { user, db };
}

/** Pure input check. Returns a list of HOLD reasons (empty = inputs usable). */
export function checkInputs({ s, evidence, measuredOn, today }) {
  const hold = [];
  if (!Number.isInteger(s) || s < S_MIN || s > S_MAX) hold.push(`S must be an integer in [${S_MIN}, ${S_MAX}] (measured), got ${JSON.stringify(s)}`);
  if (!evidence || !String(evidence).trim()) hold.push("S evidence reference is missing");
  if (measuredOn !== today) hold.push(`S was measured on ${JSON.stringify(measuredOn)}, not on the calibration day ${today}`);
  return hold;
}

/** Pure derivation (plan §9.4). */
export function derive(s, e) {
  return { kNormal: s - e - 2, kNeg: s - e + 1 };
}

/**
 * Pure E computation from raw pg_stat_activity rows
 * ({pid, usename, datname, client_addr, backend_type, application_name, is_self}).
 * Returns {e, hold, detail}. e is 0 only when proven; otherwise null with a HOLD reason.
 */
export function computeE(rows, { user, db, tagPrefix = TAG_PREFIX, selfTag } = {}) {
  const hold = [];
  const selfRows = rows.filter((r) => r.is_self === true);
  const detail = {
    rows_read: rows.length, matching_user_db_node: 0,
    excluded: { other_database: 0, other_user: 0, other_node: 0, not_client_backend: 0 },
    foreign_tagged: 0, self: null,
  };
  if (selfRows.length !== 1) {
    hold.push(`E: the probe's own backend is not uniquely visible in pg_stat_activity (${selfRows.length} rows)`);
    return { e: null, hold, detail };
  }
  const me = selfRows[0];
  detail.self = { usename: me.usename ?? null, datname: me.datname ?? null, node_visible: me.client_addr != null };
  if (me.usename !== user) hold.push(`E: probe runs as ${JSON.stringify(me.usename)}, expected the target user ${JSON.stringify(user)}`);
  if (me.datname !== db) hold.push(`E: probe is in database ${JSON.stringify(me.datname)}, expected the target database ${JSON.stringify(db)}`);
  if (me.client_addr == null) hold.push("E: the probe's client_addr (pooler node) is not visible — pool attribution impossible");
  for (const r of rows) {
    if (r.is_self === true) continue;
    if (r.application_name && String(r.application_name).startsWith(tagPrefix) && r.application_name !== selfTag) detail.foreign_tagged++;
    // usename first: Postgres hides backend_type and client_addr of other roles from a non-privileged
    // role, while usename stays visible; rows of the probe's own role are always fully visible.
    if (r.usename !== me.usename) { detail.excluded.other_user++; continue; }
    if (r.backend_type !== "client backend") { detail.excluded.not_client_backend++; continue; }
    if (r.datname !== me.datname) { detail.excluded.other_database++; continue; }
    if (me.client_addr == null || r.client_addr !== me.client_addr) { detail.excluded.other_node++; continue; }
    detail.matching_user_db_node++;
  }
  if (detail.foreign_tagged > 0) hold.push(`${detail.foreign_tagged} session(s) from another calibration run are open`);
  if (detail.matching_user_db_node > 0) {
    hold.push(
      `E: ${detail.matching_user_db_node} backend(s) share the target user, database and pooler node; ` +
        "their pool mode (session vs transaction) is not observable server-side — E cannot be attributed, no approximation is used",
    );
  }
  return { e: hold.length ? null : 0, hold, detail };
}

const EMAX = /EMAXCONNSESSION/;
const POOL_SIZE_IN_MSG = /pool_size:\s*(\d+)/;

/** Pure judgement of a finished run. Returns {verdict, reasons}. */
export function judge(r) {
  const reasons = [];
  if (r.hold && r.hold.length) return { verdict: "HOLD", reasons: [...r.hold] };
  if (r.aborted) reasons.push(`aborted: ${r.aborted}`);
  if (!r.normal || r.normal.opened !== r.kNormal) reasons.push("normal control did not open k_normal sessions");
  if (r.normal && r.normal.errors.length) reasons.push(`normal control: ${r.normal.errors.length} connection/query error(s)`);
  if (!r.negative || r.negative.skipped) {
    reasons.push("negative control did not run");
  } else {
    const rej = r.negative.rejections;
    if (rej.length !== 1) reasons.push(`negative control: ${rej.length} rejections (expected exactly 1)`);
    if (rej.length >= 1) {
      const first = rej[0];
      if (first.index !== r.kNeg) reasons.push(`negative control: rejection at session ${first.index}, expected ${r.kNeg}`);
      if (!EMAX.test(first.message || "")) reasons.push("negative control: rejection is not EMAXCONNSESSION");
      const m = POOL_SIZE_IN_MSG.exec(first.message || "");
      if (EMAX.test(first.message || "") && (!m || Number(m[1]) !== r.s)) {
        reasons.push(`negative control: server-reported pool_size ${m ? m[1] : "absent"} ≠ S ${r.s}`);
      }
    }
    if (r.negative.opened !== r.kNeg - 1) reasons.push(`negative control: ${r.negative.opened} sessions held, expected ${r.kNeg - 1}`);
  }
  if (r.cleanup && r.cleanup.timed_out) reasons.push("cleanup: the declared cleanup window expired before zero tagged sessions were verified");
  if (!r.cleanup || r.cleanup.remaining !== 0) reasons.push(`cleanup: ${r.cleanup && r.cleanup.remaining != null ? r.cleanup.remaining : "unknown"} tagged session(s) remained`);
  return reasons.length ? { verdict: "FAIL", reasons } : { verdict: "CLIENT_OK", reasons: [] };
}

// ───────────────────────────── time bounds ─────────────────────────────

export class DeadlineError extends Error {
  constructor(label) {
    super(`time bound expired: ${label}`);
    this.code = "DEADLINE";
  }
}
export class InterruptError extends Error {
  constructor(label) {
    super(`interrupted: ${label}`);
    this.code = "INTERRUPTED";
  }
}
const isStop = (e) => e && (e.code === "DEADLINE" || e.code === "INTERRUPTED");

/**
 * Race `promise` against `ms` (and an optional AbortSignal). On expiry or abort, `onExpire()`
 * is called (used to destroy the client) and the returned promise rejects. ms ≤ 0 rejects now.
 */
export function bounded(promise, ms, label, { signal, onExpire } = {}) {
  const expire = () => { try { onExpire && onExpire(); } catch { /* best effort */ } };
  Promise.resolve(promise).catch(() => {}); // the loser of the race must not surface as unhandled
  if (signal && signal.aborted) { expire(); return Promise.reject(new InterruptError(label)); }
  if (!(ms > 0)) { expire(); return Promise.reject(new DeadlineError(`${label} (no time left)`)); }
  return new Promise((res, rej) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(v);
    };
    const timer = setTimeout(() => { expire(); finish(rej, new DeadlineError(label)); }, ms);
    const onAbort = () => { expire(); finish(rej, new InterruptError(label)); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((v) => finish(res, v), (e) => finish(rej, e));
  });
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errInfo = (e) => ({ code: e && e.code ? String(e.code) : null, message: e && e.message ? String(e.message).slice(0, 300) : String(e) });

const E_ROWS_SQL =
  "select pid, usename, datname, client_addr::text as client_addr, backend_type, application_name, " +
  "(pid = pg_backend_pid()) as is_self from pg_stat_activity limit 5000";

/**
 * The calibration run, with every external effect injected:
 *   clientFactory({appName, connectMs, queryMs}) → {connect(), query(sql, params), end(), kill()}
 *   now() → ms · sleep(ms) → Promise · signal: AbortSignal (SIGINT/SIGTERM in main()).
 * Returns the report object; never throws for a stop condition.
 */
export async function runCalibration({
  url, selftest = false, s, sEvidence = "", sMeasuredOn = "", runId = "local", holdNormalMs = 60000,
  limits = LIMITS, clientFactory, now = Date.now, sleep = realSleep, signal, preflightOnly = false, log = () => {},
}) {
  const L = limits;
  const t0 = now();
  const iso = () => new Date(now()).toISOString();
  const runEndsAt = t0 + L.totalMs - L.cleanupWindowMs;
  const hardEndsAt = t0 + L.totalMs;
  const runLeft = () => runEndsAt - now();
  const tag = `${TAG_PREFIX}${runId}`;
  const verifyTag = `${tag}-verify`;
  const g = guard(url, { selftest });
  const r = {
    run_id: runId, tag, target: { ref: g.ref, hostClass: g.hostClass, port: g.port }, selftest,
    s, s_evidence: sEvidence, s_measured_on: sMeasuredOn,
    limits: { total_ms: L.totalMs, run_phase_ms: L.totalMs - L.cleanupWindowMs, cleanup_window_ms: L.cleanupWindowMs, interrupt_cleanup_ms: L.interruptCleanupMs },
    started_at: iso(), hold: [], aborted: null, e: null,
  };
  const live = new Set(); // every client created, until it is ended or destroyed
  const held = [];
  if (!g.ok) { r.hold.push(`target guard refused: ${g.reason}`); return finalize(); }

  const make = (appName, desiredConnectMs) => {
    const c = clientFactory({
      appName,
      connectMs: Math.max(1, Math.min(desiredConnectMs, runLeft())),
      queryMs: Math.max(1, Math.min(L.queryMs, runLeft())),
    });
    live.add(c);
    return c;
  };
  const kill = (c) => { try { c.kill(); } catch { /* best effort */ } live.delete(c); };
  const connect = (c, desiredMs, label) => bounded(c.connect(), Math.min(desiredMs, runLeft()), label, { signal, onExpire: () => kill(c) });
  const query = (c, sql, params, label) => bounded(c.query(sql, params), Math.min(L.queryMs, runLeft()), label, { signal, onExpire: () => kill(c) });
  const wait = (ms, label) => (ms > runLeft()
    ? Promise.reject(new DeadlineError(`${label}: ${ms} ms wait exceeds the ${Math.max(0, runLeft())} ms left`))
    : bounded(sleep(ms), runLeft(), label, { signal }));
  const close = async (c, budgetMs) => {
    await bounded(c.end(), Math.min(L.endMs, budgetMs), "end", { onExpire: () => kill(c) }).catch(() => {});
    kill(c); // ensure the socket is gone even if end() resolved without closing it
  };

  r.hold.push(...checkInputs({ s, evidence: sEvidence, measuredOn: sMeasuredOn, today: r.started_at.slice(0, 10) }));
  try {
    if (!r.hold.length) {
      // ── Preflight: tag visibility and E, from one probe session closed before any control.
      const probe = make(verifyTag, L.connectMs);
      try {
        await connect(probe, L.connectMs, "preflight connect");
        const rows = (await query(probe, E_ROWS_SQL, [], "preflight pg_stat_activity")).rows;
        const self = rows.find((x) => x.is_self === true);
        r.preflight = { at: iso(), application_name_seen: self ? self.application_name ?? null : null };
        if (r.preflight.application_name_seen !== verifyTag) r.hold.push("application_name is not visible server-side — tagged sessions cannot be verified");
        const ce = computeE(rows, { ...expectedIdentity(url), selfTag: verifyTag });
        r.e = ce.e;
        r.e_detail = ce.detail;
        r.hold.push(...ce.hold);
      } catch (err) {
        if (isStop(err)) throw err;
        r.hold.push(`preflight failed: ${errInfo(err).message}`);
      } finally {
        await close(probe, runLeft());
      }
    }
    if (!r.hold.length) {
      Object.assign(r, derive(s, r.e));
      if (r.kNormal <= 0) r.hold.push(`k_normal = S − E − 2 = ${r.kNormal} ≤ 0`);
      if (r.kNeg > S_MAX) r.hold.push(`k_neg ${r.kNeg} exceeds the cap ${S_MAX}`);
    }
    if (r.hold.length || preflightOnly) return finalize();

    r.window_start = iso();
    log(`window start ${r.window_start} · S=${s} E=${r.e} k_normal=${r.kNormal} k_neg=${r.kNeg}`);

    // ── Normal control: k_normal sessions, SELECT 1 every holdStepMs for holdNormalMs. Expected: zero errors.
    r.normal = { opened: 0, errors: [], hold_ms: holdNormalMs, started_at: iso() };
    for (let i = 1; i <= r.kNormal; i++) {
      const c = make(tag, L.connectMs);
      try { await connect(c, L.connectMs, `normal connect ${i}`); await query(c, "select 1", [], `normal select ${i}`); held.push(c); r.normal.opened++; }
      catch (err) { if (isStop(err)) throw err; r.normal.errors.push({ index: i, at: iso(), ...errInfo(err) }); await close(c, runLeft()); break; }
    }
    if (!r.normal.errors.length) {
      for (let t = 0; t < holdNormalMs; t += L.holdStepMs) {
        await wait(Math.min(L.holdStepMs, holdNormalMs - t), "normal hold");
        for (let i = 0; i < held.length; i++) {
          try { await query(held[i], "select 1", [], `normal hold select ${i + 1}`); }
          catch (err) { if (isStop(err)) throw err; r.normal.errors.push({ index: i + 1, at: iso(), ...errInfo(err) }); }
        }
        if (r.normal.errors.length) break;
      }
    }
    await Promise.all(held.splice(0).map((c) => close(c, runLeft())));
    r.normal.ended_at = iso();
    if (r.normal.errors.length) {
      r.aborted = "stop condition: error in the normal control — negative control not started";
      r.negative = { skipped: true };
      return finalize();
    }
    await wait(L.settleMs, "settle");

    // ── Negative control: open sessions one by one up to k_neg = S − E + 1. Expected: sessions 1..k_neg−1
    //    succeed and session k_neg is rejected with EMAXCONNSESSION. Any earlier rejection stops the control.
    //    A deadline or interrupt is an abort, never counted as a rejection.
    r.negative = { opened: 0, rejections: [], started_at: iso() };
    for (let i = 1; i <= r.kNeg; i++) {
      const want = i === r.kNeg ? L.lastNegConnectMs : L.connectMs;
      const c = make(tag, want);
      try {
        await connect(c, want, `negative connect ${i}`); await query(c, "select 1", [], `negative select ${i}`); held.push(c); r.negative.opened++;
      } catch (err) {
        if (isStop(err)) throw err;
        r.negative.rejections.push({ index: i, at: iso(), ...errInfo(err) });
        await close(c, runLeft());
        break; // never open past the first rejection
      }
    }
    r.negative.ended_at = iso();
  } catch (err) {
    r.aborted = isStop(err) ? err.message : `crash: ${errInfo(err).message}`;
    if (r.window_start && !r.negative) r.negative = { skipped: true };
  }
  return finalize(true);

  // ── Cleanup: declared, bounded window; never past totalMs.
  async function finalize(ran = false) {
    if (ran || live.size) {
      const interrupted = !!(signal && signal.aborted);
      const windowMs = interrupted ? L.interruptCleanupMs : L.cleanupWindowMs;
      const cleanupEndsAt = Math.min(now() + windowMs, hardEndsAt);
      const left = () => cleanupEndsAt - now();
      r.cleanup = { window_ms: windowMs, interrupted, remaining: null, polls: [], terminated: 0, timed_out: false, started_at: iso() };
      await Promise.all([...live].map((c) => close(c, left())));
      held.length = 0;
      if (r.window_start) {
        let v = null;
        try {
          v = clientFactory({ appName: verifyTag, connectMs: Math.max(1, Math.min(L.connectMs, left())), queryMs: Math.max(1, Math.min(L.queryMs, left())) });
          live.add(v);
          const vq = (sql, params, label) => bounded(v.query(sql, params), Math.min(L.queryMs, left()), label, { onExpire: () => kill(v) });
          await bounded(v.connect(), Math.min(L.connectMs, left()), "cleanup connect", { onExpire: () => kill(v) });
          for (;;) {
            const q = await vq("select count(*)::int as n from pg_stat_activity where application_name = $1", [tag], "cleanup count");
            r.cleanup.polls.push({ at: iso(), n: q.rows[0].n });
            r.cleanup.remaining = q.rows[0].n;
            if (q.rows[0].n === 0) break;
            // Keep enough of the window for terminate + recount; poll at ≤ 1/10 of the window.
            const reserve = Math.min(2 * L.queryMs, Math.floor(windowMs / 2));
            const pause = Math.min(L.pollMs, Math.max(1, Math.floor(windowMs / 10)), left() - reserve);
            if (pause <= 0) {
              // Last resort on our own tagged sessions only; the verdict stays FAIL (judge()).
              const k = await vq("select count(*) filter (where pg_terminate_backend(pid))::int as k from pg_stat_activity where application_name = $1 and usename = current_user", [tag], "cleanup terminate");
              r.cleanup.terminated = k.rows[0].k;
              const q2 = await vq("select count(*)::int as n from pg_stat_activity where application_name = $1", [tag], "cleanup recount");
              r.cleanup.after_terminate = q2.rows[0].n;
              break;
            }
            await bounded(sleep(pause), left(), "cleanup poll wait");
          }
        } catch (err) {
          if (err && err.code === "DEADLINE") r.cleanup.timed_out = true;
          r.cleanup.error = errInfo(err);
        } finally {
          if (v) await close(v, Math.max(1, left()));
        }
      }
      for (const c of [...live]) kill(c);
      r.cleanup.ended_at = iso();
      r.window_end = r.window_start ? iso() : undefined;
    }
    const j = preflightOnly && !r.hold.length && !ran ? { verdict: "PREFLIGHT_OK", reasons: [] } : judge(r);
    r.verdict = j.verdict;
    r.reasons = j.reasons;
    r.elapsed_ms = now() - t0;
    r.note = "CLIENT_OK is not PASS — PASS also needs the EMAXCONNSESSION event in the target Supavisor log stream inside [window_start, window_end] and full log coverage (plan §12).";
    r.finished_at = iso();
    return r;
  }
}

// ───────────────────────────── live entry ─────────────────────────────

function pgClientFactory(url, selftest) {
  const require = createRequire(resolve("services/search/package.json"));
  const pg = require("pg");
  // TLS verify-full against the pinned Supabase Root 2021 CA (RISK-0060; the pooler chain ends there).
  // URL ssl parameters are stripped so they cannot override this (node-pg lets the URL win).
  const target = new URL(url);
  for (const k of [...target.searchParams.keys()]) if (/^ssl/i.test(k)) target.searchParams.delete(k);
  const ssl = selftest ? false : { ca: readFileSync(resolve("infra/tls/supabase-root-2021-ca.pem"), "utf8"), rejectUnauthorized: true, servername: target.hostname };
  return ({ appName, connectMs, queryMs }) => {
    const c = new pg.Client({
      connectionString: target.toString(), application_name: appName, ssl,
      connectionTimeoutMillis: connectMs, query_timeout: queryMs, statement_timeout: queryMs,
    });
    c.on("error", () => {}); // a destroyed socket must not crash the process
    return {
      connect: () => c.connect(),
      query: (sql, params) => c.query(sql, params),
      end: () => c.end(),
      kill: () => { try { c.connection && c.connection.stream && c.connection.stream.destroy(); } catch { /* best effort */ } },
    };
  };
}

async function main() {
  const selftest = process.env.RISK0067_SELFTEST === "1";
  const url = process.env.DR_REPLACEMENT_DB_URL || "";
  const g = guard(url, { selftest });
  if (!g.ok) {
    console.log(`::error::target guard refused: ${g.reason}`);
    process.exit(2);
  }
  console.log(`target accepted · ref ${g.ref} · host ${g.hostClass} · port ${g.port}`);
  if (process.argv.includes("--guard-only")) process.exit(0);

  const out = process.env.CAL_OUT || "risk0067-dr-calibration-report.json";
  const limits = selftest ? Object.freeze({ ...LIMITS, settleMs: 1000 }) : LIMITS;
  const holdNormalMs = (selftest && process.env.CAL_HOLD_NORMAL_S ? Number(process.env.CAL_HOLD_NORMAL_S) : 60) * 1000;
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { console.log(`received ${sig} — stopping, bounded cleanup`); ac.abort(); });
  const watchdog = setTimeout(() => {
    console.log("::error::watchdog: the run outlived its declared limit — exiting");
    process.exit(1);
  }, limits.totalMs + limits.watchdogGraceMs);
  watchdog.unref();

  const r = await runCalibration({
    url, selftest, s: Number(process.env.CAL_S), sEvidence: process.env.CAL_S_EVIDENCE || "", sMeasuredOn: process.env.CAL_S_MEASURED_ON || "",
    runId: String(process.env.CAL_RUN_ID || "local").replace(/[^0-9A-Za-z-]/g, "").slice(0, 40),
    holdNormalMs, limits, clientFactory: pgClientFactory(url, selftest), signal: ac.signal,
    preflightOnly: process.argv.includes("--preflight-only"), log: (m) => console.log(m),
  });
  writeFileSync(out, JSON.stringify(r, null, 1));
  console.log(`verdict ${r.verdict}${r.reasons.length ? " — " + r.reasons.join(" | ") : ""}`);
  console.log(`window ${r.window_start || "-"} → ${r.window_end || "-"} · elapsed ${r.elapsed_ms} ms · report ${out}`);
  // Explicit exit: a pending timer of an abandoned wait/connect must not keep the process past its report.
  process.exit(r.verdict === "PREFLIGHT_OK" || r.verdict === "CLIENT_OK" ? 0 : r.verdict === "HOLD" ? 3 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.log(`::error::calibration crashed: ${errInfo(err).message}`);
    process.exit(1);
  });
}

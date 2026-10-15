#!/usr/bin/env node
// RISK-0067 · CLM-0568 · M6-18B — DR-only Supavisor session-pool calibration.
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
// CLIENT_OK is NOT PASS: PASS also needs the EMAXCONNSESSION event in DR
// `supavisor_logs` inside the window and full log coverage (read by the executor, §12).
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
  if (!r.cleanup || r.cleanup.remaining !== 0) reasons.push(`cleanup: ${r.cleanup ? r.cleanup.remaining : "unknown"} tagged session(s) remained`);
  return reasons.length ? { verdict: "FAIL", reasons } : { verdict: "CLIENT_OK", reasons: [] };
}

// ───────────────────────────── live run ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const errInfo = (e) => ({ code: e && e.code ? String(e.code) : null, message: e && e.message ? String(e.message).slice(0, 300) : String(e) });

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

  const require = createRequire(resolve("services/search/package.json"));
  const pg = require("pg");

  const runId = String(process.env.CAL_RUN_ID || "local").replace(/[^0-9A-Za-z-]/g, "").slice(0, 40);
  const tag = `risk0067-calibration-${runId}`;
  const verifyTag = `${tag}-verify`;
  const out = process.env.CAL_OUT || "risk0067-dr-calibration-report.json";
  const holdNormalS = selftest && process.env.CAL_HOLD_NORMAL_S ? Number(process.env.CAL_HOLD_NORMAL_S) : 60;
  const s = Number(process.env.CAL_S);
  const r = {
    run_id: runId, tag, target: { ref: g.ref, hostClass: g.hostClass, port: g.port }, selftest,
    s, s_evidence: process.env.CAL_S_EVIDENCE || "", s_measured_on: process.env.CAL_S_MEASURED_ON || "",
    started_at: now(), hold: [], aborted: null,
  };
  const deadline = Date.now() + 10 * 60 * 1000; // hard stop: 10 minutes for the whole run
  const write = () => writeFileSync(out, JSON.stringify(r, null, 1));
  // TLS verify-full against the pinned Supabase Root 2021 CA (RISK-0060; the pooler chain ends there).
  // URL ssl parameters are stripped so they cannot override this (node-pg lets the URL win).
  const target = new URL(url);
  for (const k of [...target.searchParams.keys()]) if (/^ssl/i.test(k)) target.searchParams.delete(k);
  const ssl = selftest ? false : { ca: readFileSync(resolve("infra/tls/supabase-root-2021-ca.pem"), "utf8"), rejectUnauthorized: true, servername: target.hostname };
  const mk = (appName, timeoutMs = 20000) =>
    new pg.Client({ connectionString: target.toString(), application_name: appName, connectionTimeoutMillis: timeoutMs, ssl, statement_timeout: 10000 });

  r.hold.push(...checkInputs({ s, evidence: r.s_evidence, measuredOn: r.s_measured_on, today: r.started_at.slice(0, 10) }));

  const held = [];
  try {
    if (!r.hold.length) {
      // ── Preflight: tag visibility and E, from one probe session that is closed before any control.
      const probe = mk(verifyTag);
      try {
        await probe.connect();
        const me = await probe.query("select application_name, current_user as usr, current_database() as db from pg_stat_activity where pid = pg_backend_pid()");
        r.preflight = { at: now(), application_name_seen: me.rows[0]?.application_name ?? null, database: me.rows[0]?.db ?? null };
        if (r.preflight.application_name_seen !== verifyTag) r.hold.push("application_name is not visible server-side — tagged sessions cannot be verified");
        const e = await probe.query(
          `select count(*)::int as e_same_node,
                  (select count(*)::int from pg_stat_activity where backend_type = 'client backend' and usename = current_user and pid <> pg_backend_pid()) as e_same_user,
                  (select count(*)::int from pg_stat_activity where application_name like 'risk0067-calibration-%' and pid <> pg_backend_pid()) as foreign_tagged
             from pg_stat_activity a
            where a.backend_type = 'client backend' and a.usename = current_user and a.pid <> pg_backend_pid()
              and a.client_addr is not distinct from (select client_addr from pg_stat_activity where pid = pg_backend_pid())`,
        );
        r.e = e.rows[0].e_same_node;
        r.e_detail = e.rows[0];
        if (e.rows[0].foreign_tagged > 0) r.hold.push(`${e.rows[0].foreign_tagged} session(s) from another calibration run are open`);
      } catch (err) {
        r.hold.push(`preflight failed: ${errInfo(err).message}`);
      } finally {
        await probe.end().catch(() => {});
      }
    }
    if (!r.hold.length) {
      Object.assign(r, derive(s, r.e));
      if (r.kNormal <= 0) r.hold.push(`k_normal = S − E − 2 = ${r.kNormal} ≤ 0`);
      if (r.kNeg > S_MAX) r.hold.push(`k_neg ${r.kNeg} exceeds the cap ${S_MAX}`);
    }
    if (r.hold.length) return;

    r.window_start = now();
    console.log(`window start ${r.window_start} · S=${s} E=${r.e} k_normal=${r.kNormal} k_neg=${r.kNeg}`);

    // ── Normal control: k_normal sessions, SELECT 1 every 10 s for holdNormalS seconds. Expected: zero errors.
    r.normal = { opened: 0, errors: [], hold_s: holdNormalS, started_at: now() };
    for (let i = 1; i <= r.kNormal; i++) {
      if (Date.now() > deadline) { r.aborted = "hard deadline in normal control"; break; }
      const c = mk(tag);
      try { await c.connect(); await c.query("select 1"); held.push(c); r.normal.opened++; }
      catch (err) { r.normal.errors.push({ index: i, at: now(), ...errInfo(err) }); await c.end().catch(() => {}); break; }
    }
    if (!r.normal.errors.length && !r.aborted) {
      for (let t = 0; t < holdNormalS; t += 10) {
        await sleep(Math.min(10, holdNormalS - t) * 1000);
        for (let i = 0; i < held.length; i++) {
          try { await held[i].query("select 1"); } catch (err) { r.normal.errors.push({ index: i + 1, at: now(), ...errInfo(err) }); }
        }
        if (r.normal.errors.length) break;
      }
    }
    await Promise.all(held.splice(0).map((c) => c.end().catch(() => {})));
    r.normal.ended_at = now();
    if (r.normal.errors.length || r.aborted) {
      r.aborted = r.aborted || "stop condition: error in the normal control — negative control not started";
      r.negative = { skipped: true };
      return;
    }
    await sleep(selftest ? 1000 : 10000);

    // ── Negative control: open sessions one by one up to k_neg = S − E + 1. Expected: sessions 1..k_neg−1
    //    succeed and session k_neg is rejected with EMAXCONNSESSION. Any earlier rejection stops the control.
    r.negative = { opened: 0, rejections: [], started_at: now() };
    for (let i = 1; i <= r.kNeg; i++) {
      if (Date.now() > deadline) { r.aborted = "hard deadline in negative control"; break; }
      const c = mk(tag, i === r.kNeg ? 75000 : 20000); // session mode may queue up to ~60 s before refusing
      try {
        await c.connect(); await c.query("select 1"); held.push(c); r.negative.opened++;
      } catch (err) {
        r.negative.rejections.push({ index: i, at: now(), ...errInfo(err) });
        await c.end().catch(() => {});
        break; // never open past the first rejection
      }
    }
    r.negative.ended_at = now();
  } finally {
    await Promise.all(held.splice(0).map((c) => c.end().catch(() => {})));
    // ── Cleanup verification: zero sessions tagged with this run's tag (polled for up to 60 s).
    if (r.window_start) {
      r.cleanup = { remaining: null, polls: [], terminated: 0 };
      const v = mk(verifyTag);
      try {
        await v.connect();
        for (let t = 0; t <= 60; t += 5) {
          const q = await v.query("select count(*)::int as n from pg_stat_activity where application_name = $1", [tag]);
          r.cleanup.polls.push({ at: now(), n: q.rows[0].n });
          r.cleanup.remaining = q.rows[0].n;
          if (q.rows[0].n === 0) break;
          await sleep(5000);
        }
        if (r.cleanup.remaining > 0) {
          // Last resort on our own tagged sessions only; the verdict stays FAIL (judge()).
          const k = await v.query("select count(*) filter (where pg_terminate_backend(pid))::int as k from pg_stat_activity where application_name = $1 and usename = current_user", [tag]);
          r.cleanup.terminated = k.rows[0].k;
          const q = await v.query("select count(*)::int as n from pg_stat_activity where application_name = $1", [tag]);
          r.cleanup.after_terminate = q.rows[0].n;
        }
      } catch (err) {
        r.cleanup.error = errInfo(err);
      } finally {
        await v.end().catch(() => {});
      }
      r.window_end = now();
    }
    const j = judge(r);
    r.verdict = j.verdict;
    r.reasons = j.reasons;
    r.note = "CLIENT_OK is not PASS — PASS also needs the EMAXCONNSESSION event in DR supavisor_logs inside [window_start, window_end] and full log coverage (plan §12).";
    r.finished_at = now();
    write();
    console.log(`verdict ${r.verdict}${r.reasons.length ? " — " + r.reasons.join(" | ") : ""}`);
    console.log(`window ${r.window_start || "-"} → ${r.window_end || "-"} · report ${out}`);
    process.exitCode = r.verdict === "CLIENT_OK" ? 0 : r.verdict === "HOLD" ? 3 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.log(`::error::calibration crashed: ${errInfo(err).message}`);
    process.exit(1);
  });
}

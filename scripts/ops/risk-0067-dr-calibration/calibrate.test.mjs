// RISK-0067 · CLM-0568 — pure checks for calibrate.mjs (no network, no secrets).
// Run: node --test scripts/ops/risk-0067-dr-calibration/calibrate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { guard, checkInputs, derive, judge, DR_REF } from "./calibrate.mjs";

const DR = `postgresql://postgres.${DR_REF}:x@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;

test("guard accepts only the DR session pooler", () => {
  const g = guard(DR);
  assert.equal(g.ok, true);
  assert.equal(g.ref, DR_REF);
  assert.equal(g.hostClass, "supavisor-session");
});

test("guard refuses production, retired production and TEST by name", () => {
  for (const ref of ["ppixaauyqoykrogwdxtv", "snlpxywskyqrjattbpgn", "obeptvwpvqbduwkahorq"]) {
    const g = guard(`postgresql://postgres.${ref}:x@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`);
    assert.equal(g.ok, false, ref);
    // even when hidden in a parameter of an otherwise-DR URL
    assert.equal(guard(`${DR}?options=${ref}`).ok, false, `${ref} in params`);
  }
});

test("guard refuses direct, transaction mode, other ports, other refs, empty", () => {
  assert.equal(guard(`postgresql://postgres:x@db.${DR_REF}.supabase.co:5432/postgres`).ok, false);
  assert.equal(guard(DR.replace(":5432", ":6543")).ok, false);
  assert.equal(guard(DR.replace(":5432", ":5433")).ok, false);
  assert.equal(guard(DR.replace(DR_REF, "abcdefghijklmnopqrst")).ok, false);
  assert.equal(guard(DR.replace("pooler.supabase.com", "example.com")).ok, false);
  assert.equal(guard("").ok, false);
  assert.equal(guard("not a url").ok, false);
  assert.equal(guard(DR.replace("postgresql:", "mysql:")).ok, false);
});

test("guard: localhost only in self-test", () => {
  const l = "postgres://calib:calib@127.0.0.1:5432/postgres";
  assert.equal(guard(l).ok, false);
  assert.equal(guard(l, { selftest: true }).ok, true);
  // self-test mode never relaxes the production refusal
  assert.equal(guard(DR.replace(DR_REF, "ppixaauyqoykrogwdxtv"), { selftest: true }).ok, false);
});

test("checkInputs: S measured today, with evidence, in range", () => {
  const today = "2026-10-15";
  assert.deepEqual(checkInputs({ s: 15, evidence: "dashboard 2026-10-15", measuredOn: today, today }), []);
  assert.equal(checkInputs({ s: NaN, evidence: "e", measuredOn: today, today }).length, 1);
  assert.equal(checkInputs({ s: 2, evidence: "e", measuredOn: today, today }).length, 1);
  assert.equal(checkInputs({ s: 15, evidence: " ", measuredOn: today, today }).length, 1);
  assert.equal(checkInputs({ s: 15, evidence: "e", measuredOn: "2026-10-14", today }).length, 1);
});

test("derive follows §9.4", () => {
  assert.deepEqual(derive(15, 1), { kNormal: 12, kNeg: 15 });
});

const base = (o = {}) => ({
  s: 15, kNormal: 12, kNeg: 15, hold: [], aborted: null,
  normal: { opened: 12, errors: [] },
  negative: { opened: 14, rejections: [{ index: 15, code: "XX000", message: "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15" }] },
  cleanup: { remaining: 0 },
  ...o,
});

test("judge: the PASS-shaped run is CLIENT_OK", () => {
  assert.equal(judge(base()).verdict, "CLIENT_OK");
});

test("judge: HOLD wins over everything", () => {
  assert.equal(judge(base({ hold: ["S missing"] })).verdict, "HOLD");
});

test("judge: every deviation is FAIL", () => {
  const rej = (m, i = 15) => ({ opened: i - 1, rejections: [{ index: i, message: m }] });
  const cases = {
    normalError: base({ normal: { opened: 12, errors: [{ index: 3, message: "x" }] } }),
    noRejection: base({ negative: { opened: 15, rejections: [] } }),
    earlyRejection: base({ negative: rej("(EMAXCONNSESSION) ... pool_size: 15", 9) }),
    wrongKind: base({ negative: rej("sorry, too many clients already") }),
    poolSizeMismatch: base({ negative: rej("(EMAXCONNSESSION) max clients are limited to pool_size: 20") }),
    timeout: base({ negative: rej("timeout expired") }),
    leftover: base({ cleanup: { remaining: 2 } }),
    cleanupUnknown: base({ cleanup: undefined }),
    negativeSkipped: base({ negative: { skipped: true } }),
    aborted: base({ aborted: "hard deadline" }),
  };
  for (const [k, r] of Object.entries(cases)) assert.equal(judge(r).verdict, "FAIL", k);
});

// ─────────────── CLM-0573: E scope, hard time limit, bounded cleanup ───────────────
// What these tests prove (and nothing more is claimed in calibrate.mjs):
//  · computeE counts only client backends of the probe's user + database + pooler node;
//    other databases / users / nodes / non-client backends are excluded and reported;
//    any matching row ⇒ HOLD (mode not observable), never an approximate E.
//  · bounded() rejects at its bound and destroys the client; an abort rejects at once.
//  · runCalibration (fake clients, scaled limits): a connect that never returns, a wait longer
//    than the time left, an interrupt and a hanging cleanup all end within totalMs (+ timer
//    slack), with every created client ended or destroyed; a deadline is an abort, not a rejection.
import { computeE, expectedIdentity, bounded, runCalibration, LIMITS, TAG_PREFIX } from "./calibrate.mjs";

const SELF = { pid: 1, usename: "postgres", datname: "postgres", client_addr: "10.0.0.5", backend_type: "client backend", application_name: "risk0067-calibration-x-verify", is_self: true };
const row = (o) => ({ pid: 9, usename: "postgres", datname: "postgres", client_addr: "10.0.0.5", backend_type: "client backend", application_name: "", is_self: false, ...o });
const ID = { user: "postgres", db: "postgres", selfTag: SELF.application_name };

test("expectedIdentity: Supavisor login maps to the database user; path is the database", () => {
  assert.deepEqual(expectedIdentity(DR), { user: "postgres", db: "postgres" });
  assert.deepEqual(expectedIdentity("postgres://calib@127.0.0.1:5432/postgres"), { user: "calib", db: "postgres" });
});

test("computeE: other databases, users, nodes and non-client backends are not counted — E = 0 proven", () => {
  const rows = [
    SELF,
    row({ pid: 2, datname: "other_db" }),
    row({ pid: 3, datname: "other_db", application_name: "Supavisor" }),
    row({ pid: 4, usename: "authenticator", backend_type: null, client_addr: null }),
    row({ pid: 5, usename: "supabase_admin", client_addr: null }),
    row({ pid: 6, client_addr: "10.0.0.9" }), // same user/db through another node or a direct connection
    row({ pid: 7, client_addr: null }),
    row({ pid: 8, backend_type: "autovacuum launcher", usename: null, datname: null, client_addr: null }),
    row({ pid: 10, backend_type: "walsender" }),
    // another role as a non-privileged reader sees it: backend_type and client_addr hidden
    // (it is still excluded as other_user, never as a candidate)
  ];
  const r = computeE(rows, ID);
  assert.deepEqual(r.hold, []);
  assert.equal(r.e, 0);
  assert.equal(r.detail.matching_user_db_node, 0);
  assert.deepEqual(r.detail.excluded, { other_database: 2, other_user: 3, other_node: 2, not_client_backend: 1 });
});

test("computeE: a same user + database + node backend cannot be attributed to session mode ⇒ HOLD, no E", () => {
  for (const app of ["", "Supavisor", "some-app"]) {
    const r = computeE([SELF, row({ pid: 2, application_name: app }), row({ pid: 3, datname: "other_db" })], ID);
    assert.equal(r.e, null, app);
    assert.equal(r.detail.matching_user_db_node, 1);
    assert.ok(r.hold.some((h) => h.includes("not observable")), app);
  }
});

test("computeE: probe identity must match the target user, database and a visible node", () => {
  assert.equal(computeE([row({ pid: 2 })], ID).e, null); // self missing
  assert.equal(computeE([SELF, { ...SELF, pid: 2 }], ID).e, null); // self ambiguous
  assert.ok(computeE([{ ...SELF, usename: "other" }], ID).hold.some((h) => h.includes("target user")));
  assert.ok(computeE([{ ...SELF, datname: "other_db" }], ID).hold.some((h) => h.includes("target database")));
  assert.ok(computeE([{ ...SELF, client_addr: null }], ID).hold.some((h) => h.includes("not visible")));
});

test("computeE: a foreign calibration tag anywhere ⇒ HOLD", () => {
  const r = computeE([SELF, row({ pid: 2, datname: "other_db", application_name: `${TAG_PREFIX}other-run` })], ID);
  assert.equal(r.e, null);
  assert.ok(r.hold.some((h) => h.includes("another calibration run")));
});

test("declared live limits: 10 min total including a 90 s cleanup window", () => {
  assert.equal(LIMITS.totalMs, 600000);
  assert.equal(LIMITS.cleanupWindowMs, 90000);
  assert.ok(LIMITS.lastNegConnectMs + LIMITS.queryMs < LIMITS.totalMs - LIMITS.cleanupWindowMs);
  assert.ok(Object.isFrozen(LIMITS));
});

test("bounded: rejects at its bound and destroys; abort rejects at once", async () => {
  let killed = 0;
  const t = Date.now();
  await assert.rejects(bounded(new Promise(() => {}), 40, "x", { onExpire: () => killed++ }), (e) => e.code === "DEADLINE");
  assert.ok(Date.now() - t < 200);
  assert.equal(killed, 1);
  await assert.rejects(bounded(new Promise(() => {}), 0, "y", { onExpire: () => killed++ }), (e) => e.code === "DEADLINE");
  const ac = new AbortController();
  const p = bounded(new Promise(() => {}), 10000, "z", { signal: ac.signal, onExpire: () => killed++ });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (e) => e.code === "INTERRUPTED");
  assert.equal(killed, 3);
  assert.equal(await bounded(Promise.resolve(7), 50, "ok"), 7);
});

// Fake server: pg_stat_activity of live tagged clients + extra rows; session limit `poolSize`.
function fakeServer({ poolSize = 7, extraRows = [], hangConnectAt = null, hangEnd = false, hangVerifyConnect = false, stickyTagged = 0 } = {}) {
  const clients = [];
  let pid = 100;
  const alive = () => clients.filter((c) => c.connected && !c.ended && !c.killed);
  const factory = ({ appName }) => {
    const c = { appName, pid: ++pid, connected: false, ended: false, killed: false, connects: 0 };
    c.connect = () => {
      const isVerify = appName.endsWith("-verify");
      const nControl = clients.filter((x) => !x.appName.endsWith("-verify")).indexOf(c) + 1;
      if (isVerify && hangVerifyConnect && clients.some((x) => x.appName === appName && x !== c)) return new Promise(() => {});
      if (!isVerify && hangConnectAt !== null && nControl === hangConnectAt) return new Promise(() => {});
      if (alive().length >= poolSize) {
        return Promise.reject(Object.assign(new Error(`(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: ${poolSize}`), { code: "XX000" }));
      }
      c.connected = true;
      return Promise.resolve();
    };
    c.query = (sql, params) => {
      if (c.killed || c.ended) return Promise.reject(new Error("connection closed"));
      if (sql.includes("is_self")) {
        return Promise.resolve({ rows: [...alive().map((x) => ({ ...SELF, pid: x.pid, application_name: x.appName, is_self: x === c })), ...extraRows] });
      }
      if (sql.includes("pg_terminate_backend")) return Promise.resolve({ rows: [{ k: stickyTagged }] });
      if (sql.includes("count(*)")) {
        const n = alive().filter((x) => x.appName === params[0]).length + stickyTagged;
        return Promise.resolve({ rows: [{ n }] });
      }
      return Promise.resolve({ rows: [{ "?column?": 1 }] });
    };
    c.end = () => { if (hangEnd && !c.appName.endsWith("-verify")) return new Promise(() => {}); c.ended = true; return Promise.resolve(); };
    c.kill = () => { c.killed = true; };
    clients.push(c);
    return c;
  };
  return { factory, clients, alive };
}

const FAST = Object.freeze({ ...LIMITS, totalMs: 1500, cleanupWindowMs: 400, interruptCleanupMs: 150, connectMs: 100, lastNegConnectMs: 150, queryMs: 100, endMs: 50, holdStepMs: 20, settleMs: 10, pollMs: 20 });
const today = () => new Date().toISOString().slice(0, 10);
const run = (srv, o = {}) => runCalibration({
  url: "postgres://postgres@127.0.0.1:5432/postgres", selftest: true, s: 7, sEvidence: "unit", sMeasuredOn: today(),
  runId: "t", holdNormalMs: 60, limits: FAST, clientFactory: srv.factory, ...o,
});
const allClosed = (srv) => srv.clients.every((c) => c.ended || c.killed || !c.connected);

test("runCalibration (fake): the PASS-shaped run is CLIENT_OK with E = 0 and cleanup 0", async () => {
  const srv = fakeServer({ poolSize: 7, extraRows: [row({ pid: 2, datname: "other_db" }), row({ pid: 3, usename: "authenticator" })] });
  const r = await run(srv);
  assert.equal(r.verdict, "CLIENT_OK", r.reasons.join(" | "));
  assert.equal(r.e, 0);
  assert.deepEqual([r.kNormal, r.kNeg, r.negative.opened, r.negative.rejections[0].index], [5, 8, 7, 8]);
  assert.equal(r.cleanup.remaining, 0);
  assert.ok(allClosed(srv));
});

test("runCalibration (fake): a matching unattributable backend ⇒ HOLD before any control session", async () => {
  const srv = fakeServer({ extraRows: [row({ pid: 2, application_name: "Supavisor" })] });
  const r = await run(srv);
  assert.equal(r.verdict, "HOLD");
  assert.equal(r.e, null);
  assert.equal(r.window_start, undefined);
  assert.equal(srv.clients.length, 1); // only the probe
  assert.ok(allClosed(srv));
});

test("runCalibration (fake): a connect that never returns ends within totalMs, aborted not rejected", async () => {
  const srv = fakeServer({ poolSize: 7, hangConnectAt: 3 });
  const lim = { ...FAST, connectMs: 100000, lastNegConnectMs: 100000 }; // only the deadline can stop it
  const t = Date.now();
  const r = await run(srv, { limits: lim });
  const took = Date.now() - t;
  assert.ok(took <= lim.totalMs + 150, `took ${took} ms`);
  assert.equal(r.verdict, "FAIL");
  assert.match(r.aborted, /time bound expired: normal connect 3/);
  assert.equal(r.normal.errors.length, 0);
  assert.equal(r.cleanup.remaining, 0);
  assert.ok(allClosed(srv));
  assert.ok(srv.clients[3].killed, "the hung client is destroyed");
});

test("runCalibration (fake): a wait longer than the time left is refused up front", async () => {
  const srv = fakeServer({ poolSize: 7 });
  const t = Date.now();
  const r = await run(srv, { holdNormalMs: 60000, limits: { ...FAST, holdStepMs: 10000 } });
  assert.ok(Date.now() - t <= FAST.totalMs + 150);
  assert.match(r.aborted, /time bound expired: normal hold/);
  assert.equal(r.verdict, "FAIL");
  assert.ok(allClosed(srv));
});

test("runCalibration (fake): the last negative session is capped by the time left", async () => {
  const srv = fakeServer({ poolSize: 7, hangConnectAt: 13 }); // 5 normal + 8th negative
  const lim = { ...FAST, lastNegConnectMs: 100000 };
  const t = Date.now();
  const r = await run(srv, { limits: lim });
  assert.ok(Date.now() - t <= lim.totalMs + 150);
  assert.match(r.aborted, /time bound expired: negative connect 8/);
  assert.equal(r.negative.rejections.length, 0, "a deadline is never counted as the rejection");
  assert.equal(r.verdict, "FAIL");
  assert.ok(allClosed(srv));
});

test("runCalibration (fake): an interrupt stops at once and cleans up inside the interrupt window", async () => {
  const srv = fakeServer({ poolSize: 7 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 40);
  const t = Date.now();
  const r = await run(srv, { holdNormalMs: 1000, signal: ac.signal, limits: { ...FAST, totalMs: 5000 } });
  const took = Date.now() - t;
  assert.ok(took <= 40 + FAST.interruptCleanupMs + 150, `took ${took} ms`);
  assert.match(r.aborted, /interrupted/);
  assert.equal(r.cleanup.interrupted, true);
  assert.equal(r.cleanup.window_ms, FAST.interruptCleanupMs);
  assert.equal(r.cleanup.remaining, 0);
  assert.equal(srv.alive().length, 0);
  assert.equal(r.verdict, "FAIL");
});

test("runCalibration (fake): hanging end() and a hanging verify connect stay inside the cleanup window", async () => {
  const srv = fakeServer({ poolSize: 7, hangConnectAt: 3, hangEnd: true, hangVerifyConnect: true });
  const t = Date.now();
  const r = await run(srv);
  const took = Date.now() - t;
  assert.ok(took <= FAST.totalMs + 150, `took ${took} ms`);
  assert.equal(r.cleanup.timed_out, true);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reasons.some((x) => x.includes("cleanup window expired")));
  assert.equal(srv.alive().length, 0, "every client is destroyed even when end() hangs");
});

test("runCalibration (fake): tagged sessions that do not leave are terminated inside the window and stay FAIL", async () => {
  const srv = fakeServer({ poolSize: 7, stickyTagged: 1 });
  const t = Date.now();
  const r = await run(srv);
  assert.ok(Date.now() - t <= FAST.totalMs + 150);
  assert.equal(r.cleanup.terminated, 1);
  assert.equal(r.verdict, "FAIL");
});

test("runCalibration: preflight-only reports E without opening any control session", async () => {
  const srv = fakeServer({ extraRows: [row({ pid: 2, datname: "other_db" })] });
  const r = await run(srv, { preflightOnly: true });
  assert.equal(r.verdict, "PREFLIGHT_OK");
  assert.equal(r.e, 0);
  assert.equal(srv.clients.length, 1);
  assert.ok(allClosed(srv));
});

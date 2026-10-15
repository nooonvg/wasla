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

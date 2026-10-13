/**
 * M6-18B · RISK-0067 · CLM-0546 — L1 isolated load measurement (matrix §5).
 *
 * Non-production harness. It never touches the production database, Supavisor, or
 * Render. It runs on a throwaway local postgres:17 with `max_connections=40`
 * (simulating the 40 Supavisor session slots) and the 17 real DB services, each
 * started from its own `src/http/server.ts` with the shipped `withPgPoolDefaults`
 * (`max` default 2, `WASLA_PG_POOL_MAX` absent ⇒ default).
 *
 * What it measures:
 *   - peak `pg_stat_activity` (the app-side worst case must stay ≤ 34 = 17 × 2);
 *   - per-step: total requests, 5xx, timeouts, `53300 too_many_connections`, p95 ms;
 *   - recovery after `pg_terminate_backend` on a test connection;
 *   - the 17 services stay alive and `/health` 200 through the whole window.
 *
 * What it does NOT prove: Supavisor's own behaviour (`EMAXCONNSESSION`) — that is the
 * L2 layer / a live measurement, gated on an owner-approved isolated project.
 *
 * Run (from repo root, with a throwaway postgres on ${PG_PORT}):
 *   PG_PORT=55434 ./services/audit/node_modules/.bin/tsx scripts/ops/m6-18b-dr/l1-isolated-load.mts
 * Fails closed (exit 1) when any pass criterion is not met.
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

const PG_PORT = Number(process.env.PG_PORT ?? "55434");
const DB_URL = `postgres://postgres@127.0.0.1:${PG_PORT}/wasla_l1`;
const WASLA_PG_POOL_MAX = process.env.WASLA_PG_POOL_MAX ?? null; // absent ⇒ default 2

// The 17 DB services that build a `pg.Pool` via `withPgPoolDefaults` (matrix §5).
const SERVICES: Array<{ name: string; port: number; envKey: string }> = [
  { name: "audit", port: 18101, envKey: "DATABASE_URL" },
  { name: "billing", port: 18102, envKey: "BILLING_DATABASE_URL" },
  { name: "customers", port: 18103, envKey: "CUSTOMER_DATABASE_URL" },
  { name: "delivery", port: 18104, envKey: "DELIVERY_DATABASE_URL" },
  { name: "dispatch", port: 18105, envKey: "DISPATCH_DATABASE_URL" },
  { name: "drivers", port: 18106, envKey: "DRIVER_DATABASE_URL" },
  { name: "geography", port: 18107, envKey: "DATABASE_URL" },
  { name: "identity", port: 18108, envKey: "DATABASE_URL" },
  { name: "marketplace", port: 18109, envKey: "DATABASE_URL" },
  { name: "matching", port: 18110, envKey: "DATABASE_URL" },
  { name: "negotiations", port: 18111, envKey: "NEGOTIATION_DATABASE_URL" },
  { name: "orders", port: 18112, envKey: "ORDER_DATABASE_URL" },
  { name: "partners", port: 18113, envKey: "PARTNERS_DATABASE_URL" },
  { name: "reputation", port: 18114, envKey: "DATABASE_URL" },
  { name: "search", port: 18115, envKey: "DATABASE_URL" },
  { name: "subscriptions", port: 18116, envKey: "DATABASE_URL" },
  { name: "support", port: 18117, envKey: "DATABASE_URL" },
];

type Step = {
  concurrency: number;
  duration_ms: number;
  total_requests: number;
  errors_5xx: number;
  errors_53300: number;
  timeouts: number;
  p95_ms: number;
  p99_ms: number;
  peak_pg_stat_activity: number;
};

type ServiceProc = { name: string; proc: ChildProcess | null; port: number };

async function startService(s: { name: string; port: number; envKey: string }): Promise<ServiceProc> {
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(s.port),
  } as Record<string, string>;
  env[s.envKey] = DB_URL;
  env.WASLA_PG_SSL_MODE = "off"; // local postgres, trust auth
  const proc = spawn("./services/audit/node_modules/.bin/tsx", [
    `services/${s.name}/src/http/server.ts`,
  ], { env, stdio: "ignore", detached: true });
  return { name: s.name, proc, port: s.port };
}

async function waitForPort(port: number, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const s = net.connect(port, "127.0.0.1");
      s.on("error", () => undefined);
      s.destroy();
      await new Promise((r) => setTimeout(r, 120));
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function fetchJSON(url: string, timeoutMs = 4000): Promise<{ status: number; body?: unknown; ms: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const ms = Date.now() - start;
    let body: unknown;
    try { body = await resp.json(); } catch { body = undefined; }
    return { status: resp.status, body, ms };
  } finally {
    clearTimeout(t);
  }
}

async function pgStatActivityPeak(): Promise<number> {
  // Read via a throwaway TCP client to the postgres container's psql — do it via the
  // docker exec API instead (no pg client in the Node process). Call the exported
  // `dockerExec` helper below.
  return dockerExecPeak();
}

let lastPeak = 0;
async function dockerExecPeak(): Promise<number> {
  // We use `docker exec` from the Node process (this is a harness running on a
  // GitHub Actions runner, so docker is available; locally it is too, per the repo
  // pattern of dr-replacement-restore.yml).
  return new Promise<number>((resolve) => {
    const p = spawn("docker", [
      "exec", "s2-pg-l1", "psql", "-U", "postgres", "-d", "wasla_l1",
      "-tc", "select count(*) from pg_stat_activity where usename is not null",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d; });
    p.on("close", () => {
      const n = parseInt(out.trim() || "0", 10);
      lastPeak = Math.max(lastPeak, isNaN(n) ? 0 : n);
      resolve(lastPeak);
    });
    p.on("error", () => resolve(lastPeak));
  });
}

async function terminateBackend(): Promise<boolean> {
  // Find one idle connection from the app and terminate it, to prove the pool recovers.
  return new Promise<boolean>((resolve) => {
    const p = spawn("docker", [
      "exec", "s2-pg-l1", "psql", "-U", "postgres", "-d", "wasla_l1",
      "-tc", "select pg_terminate_backend(pid) from pg_stat_activity where usename is not null and application_name='' limit 1",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d; });
    p.on("close", () => resolve(out.trim().startsWith("t")));
    p.on("error", () => resolve(false));
  });
}

function p95(sortedMs: number[]): number {
  if (!sortedMs.length) return 0;
  const i = Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * 0.95));
  return sortedMs[i];
}

function p99(sortedMs: number[]): number {
  if (!sortedMs.length) return 0;
  const i = Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * 0.99));
  return sortedMs[i];
}

async function main(): Promise<void> {
  const result: Record<string, unknown> = {
    env: {
      pg_port: PG_PORT,
      max_connections: null, // filled after measuring
      wasla_pg_pool_max: WASLA_PG_POOL_MAX,
      services: SERVICES.map((s) => s.name),
    },
    fleet: { started: [] as string[], not_started: [] as string[] },
    steps: [] as Step[],
    recovery: {},
    verdict: { checks: [], pass: false },
  };

  // Measure max_connections on the throwaway DB.
  result.env.max_connections = await new Promise<string>((resolve) => {
    const p = spawn("docker", [
      "exec", "s2-pg-l1", "psql", "-U", "postgres", "-d", "wasla_l1", "-tc", "SHOW max_connections;",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d; });
    p.on("close", () => resolve(out.trim() || "unknown"));
    p.on("error", () => resolve("unknown"));
  });

  // Start all 17 services, each with its own pool.
  const procs: ServiceProc[] = [];
  for (const s of SERVICES) {
    const p = await startService(s);
    const ok = await waitForPort(s.port, 6000);
    if (ok) (result.fleet.started as string[]).push(s.name);
    else (result.fleet.not_started as string[]).push(s.name);
    procs.push(p);
  }
  // Give pools a moment to settle.
  await new Promise((r) => setTimeout(r, 3000));

  const CONCURRENCIES = [10, 50, 100, 200];
  const STEP_MS = 60_000; // 60 s per step per the matrix.

  for (const conc of CONCURRENCIES) {
    const latencies: number[] = [];
    let total = 0, errors5xx = 0, errors53300 = 0, timeouts = 0;
    const stopAt = Date.now() + STEP_MS;

    const worker = async (id: number): Promise<void> => {
      while (Date.now() < stopAt) {
        const s = procs[(id + Math.floor(Math.random() * procs.length)) % procs.length];
        try {
          const r = await fetchJSON(`http://127.0.0.1:${s.port}/health`, 4000);
          latencies.push(r.ms);
          total++;
          if (r.status >= 500) errors5xx++;
          if (r.body && typeof r.body === "object" && "code" in (r.body as Record<string, unknown>) && String((r.body as Record<string, unknown>).code).includes("53300")) errors53300++;
        } catch (e) {
          timeouts++;
          total++;
          const msg = String((e as Error).message || "");
          if (msg.includes("53300") || msg.includes("too_many_connections")) errors53300++;
        }
      }
    };

    const peakInterval = setInterval(() => { void pgStatActivityPeak(); }, 1500);

    const workers = Array.from({ length: conc }, (_, i) => worker(i));
    await Promise.all(workers);
    clearInterval(peakInterval);
    await pgStatActivityPeak(); // final read for the step.

    const sorted = [...latencies].sort((a, b) => a - b);
    (result.steps as Step[]).push({
      concurrency: conc,
      duration_ms: STEP_MS,
      total_requests: total,
      errors_5xx: errors5xx,
      errors_53300: errors53300,
      timeouts: timeouts,
      p95_ms: p95(sorted),
      p99_ms: p99(sorted),
      peak_pg_stat_activity: lastPeak,
    });
    lastPeak = 0; // reset per step
  }

  // Recovery after pg_terminate_backend.
  const killed = await terminateBackend();
  await new Promise((r) => setTimeout(r, 1000));
  let alive = 0;
  for (const p of procs) {
    const r = await fetchJSON(`http://127.0.0.1:${p.port}/health`, 3000);
    if (r.status === 200) alive++;
  }
  (result.recovery as Record<string, unknown>) = {
    pg_terminate_backend: killed,
    alive_after: alive,
    of: procs.length,
  };

  // Verdict — fail closed.
  const steps = result.steps as Step[];
  const checks: Array<{ id: string; detail: string; pass: boolean }> = [];

  const peakOverall = Math.max(...steps.map((s) => s.peak_pg_stat_activity));
  checks.push({
    id: "PEAK_LE_34",
    detail: `peak pg_stat_activity = ${peakOverall} (worst case 17×2 = 34, Supavisor slot ceiling 40)`,
    pass: peakOverall <= 34,
  });
  checks.push({
    id: "NO_53300",
    detail: `errors_53300 across all steps = ${steps.reduce((a, s) => a + s.errors_53300, 0)}`,
    pass: steps.reduce((a, s) => a + s.errors_53300, 0) === 0,
  });
  checks.push({
    id: "NO_5XX",
    detail: `errors_5xx across all steps = ${steps.reduce((a, s) => a + s.errors_5xx, 0)}`,
    pass: steps.reduce((a, s) => a + s.errors_5xx, 0) === 0,
  });
  checks.push({
    id: "NO_TIMEOUTS",
    detail: `timeouts across all steps = ${steps.reduce((a, s) => a + s.timeouts, 0)}`,
    pass: steps.reduce((a, s) => a + s.timeouts, 0) === 0,
  });
  checks.push({
    id: "P95_LE_500",
    detail: `max p95 across all steps = ${Math.max(...steps.map((s) => s.p95_ms))} ms (SLO ≤ 500 ms, M4-03)`,
    pass: Math.max(...steps.map((s) => s.p95_ms)) <= 500,
  });
  checks.push({
    id: "FLEET_STARTED",
    detail: `${(result.fleet.started as string[]).length}/17 services started`,
    pass: (result.fleet.started as string[]).length === 17,
  });
  checks.push({
    id: "RECOVERY",
    detail: `alive_after pg_terminate_backend = ${alive}/17`,
    pass: alive === 17,
  });

  (result.verdict as Record<string, unknown>).checks = checks;
  (result.verdict as Record<string, unknown>).pass = checks.every((c) => c.pass);

  // Clean up.
  for (const p of procs) {
    if (p.proc && p.proc.exitCode === null) {
      try { p.proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }

  process.stdout.write(JSON.stringify(result, null, 2));
  process.exit((result.verdict as Record<string, unknown>).pass ? 0 : 1);
}

void main();

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
import { randomBytes } from "node:crypto";

const PG_PORT = Number(process.env.PG_PORT ?? "55434");
const DB_URL = `postgres://postgres@127.0.0.1:${PG_PORT}/wasla_l1`;
const SECRET = randomBytes(32).toString("hex"); // throwaway, matches scenario2-db-unavailable.mts.
const WASLA_PG_POOL_MAX = process.env.WASLA_PG_POOL_MAX ?? null; // absent ⇒ default 2

// The 17 DB services that build a `pg.Pool` via `withPgPoolDefaults` (matrix §5).
// health/dbEnv mirror the pattern of scenario2-db-unavailable.mts exactly.
const SERVICES: ReadonlyArray<{ name: string; port: number; health: string; dbEnv: string }> = [
  { name: "audit", port: 18201, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "billing", port: 18202, health: "/billing/health", dbEnv: "BILLING_DATABASE_URL" },
  { name: "customers", port: 18203, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "delivery", port: 18204, health: "/delivery/health", dbEnv: "DATABASE_URL" },
  { name: "dispatch", port: 18205, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "drivers", port: 18206, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "geography", port: 18207, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "identity", port: 18208, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "marketplace", port: 18209, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "matching", port: 18210, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "negotiations", port: 18211, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "orders", port: 18212, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "partners", port: 18213, health: "/partners/health", dbEnv: "PARTNERS_DATABASE_URL" },
  { name: "reputation", port: 18214, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "search", port: 18215, health: "/search/health", dbEnv: "DATABASE_URL" },
  { name: "subscriptions", port: 18216, health: "/health", dbEnv: "DATABASE_URL" },
  { name: "support", port: 18217, health: "/health", dbEnv: "DATABASE_URL" },
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

type FleetMember = { service: string; port: number; health: string; child: ChildProcess; stderr: string; exited: boolean; childProc?: ChildProcess };

function firstErrorLines(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("Deprecation"))
    .slice(-3);
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
  });
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
  } catch {
    return { status: 0, body: undefined, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

async function healthStatus(port: number, path: string, timeoutMs = 1000): Promise<{ status: number; ms: number }> {
  const r = await fetchJSON(`http://127.0.0.1:${port}${path}`, timeoutMs);
  return { status: r.status, ms: r.ms };
}

async function dockerExecPsql(sql: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const p = spawn("docker", [
      "exec", "s2-pg-l1", "psql", "-U", "postgres", "-d", "wasla_l1", "-tc", sql,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d; });
    p.on("close", () => resolve(out.trim()));
    p.on("error", (e: Error) => reject(e));
  });
}

async function pgStatActivityCount(): Promise<number> {
  const out = await dockerExecPsql("select count(*) from pg_stat_activity where usename is not null");
  const n = parseInt(out || "0", 10);
  return isNaN(n) ? 0 : n;
}

async function terminateBackend(): Promise<boolean> {
  const out = await dockerExecPsql(
    "select pg_terminate_backend(pid) from pg_stat_activity where usename is not null and application_name='' limit 1"
  );
  return out.startsWith("t");
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

async function startFleet(): Promise<{ members: FleetMember[]; notStarted: Array<{ service: string; reason: string }> }> {
  const members: FleetMember[] = [];
  const notStarted: Array<{ service: string; reason: string }> = [];

  for (const s of SERVICES) {
    const child = spawn("./services/audit/node_modules/.bin/tsx", [`services/${s.name}/src/http/server.ts`], {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(s.port),
        [s.dbEnv]: DB_URL,
        WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
        OTEL_SDK_DISABLED: "true",
        WASLA_SERVICE_AUTH_KEYS: `dr1:active:${SECRET}`,
        WASLA_SERVICE_AUTH_ACTIVE_KID: "dr1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let exited = false;
    child.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("exit", () => (exited = true));
    members.push({ service: s.name, port: s.port, health: s.health, child, stderr: "", exited, childProc: child });
    // keep stderr text on the member
    const m = members[members.length - 1];
    child.stderr?.on("data", (d: Buffer) => { m.stderr = (m.stderr + d.toString()).slice(-4000); });
    child.on("exit", () => { m.exited = true; });
  }

  const deadline = Date.now() + 90_000;
  const pending = new Set(members);
  while (pending.size > 0 && Date.now() < deadline) {
    for (const m of [...pending]) {
      if (m.exited) { pending.delete(m); continue; }
      const h = await healthStatus(m.port, m.health, 1_000);
      if (h.status === 200) pending.delete(m);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const m of members) {
    if (m.exited || pending.has(m)) {
      notStarted.push({
        service: m.service,
        reason: m.exited
          ? `exited: ${firstErrorLines(m.stderr).join(" | ").slice(0, 300)}`
          : "health not 200 within 90 s",
      });
    }
  }
  return { members: members.filter((m) => !m.exited && !pending.has(m)), notStarted };
}

async function main(): Promise<void> {
  const result = {
    env: {
      pg_port: PG_PORT,
      max_connections: "unknown" as string,
      wasla_pg_pool_max: WASLA_PG_POOL_MAX,
      db_url_masked: "postgres://postgres@127.0.0.1:<port>/wasla_l1",
    },
    fleet: { started: [] as string[], not_started: [] as Array<{ service: string; reason: string }> },
    steps: [] as Step[],
    recovery: {} as Record<string, unknown>,
    verdict: { checks: [] as Array<{ id: string; detail: string; pass: boolean }>, pass: false },
  };

  // Measure max_connections on the throwaway DB.
  try {
    result.env.max_connections = (await dockerExecPsql("SHOW max_connections;")) || "unknown";
  } catch (e) {
    result.env.max_connections = `error: ${(e as Error).message}`;
  }

  // Start all 17 services.
  const fleet = await startFleet();
  result.fleet.started.push(...fleet.members.map((m) => m.service));
  result.fleet.not_started.push(...fleet.notStarted);

  // Give pools a moment to settle.
  await new Promise((r) => setTimeout(r, 3000));

  // Measure the baseline (idle) pg_stat_activity.
  let lastPeak = await pgStatActivityCount();

  const CONCURRENCIES = [10, 50, 100, 200];
  const STEP_MS = 60_000; // 60 s per step per the matrix.

  for (const conc of CONCURRENCIES) {
    const latencies: number[] = [];
    let total = 0, errors5xx = 0, errors53300 = 0, timeouts = 0;
    const stopAt = Date.now() + STEP_MS;

    const worker = async (id: number): Promise<void> => {
      while (Date.now() < stopAt) {
        const s = fleet.members[(id + Math.floor(Math.random() * fleet.members.length)) % fleet.members.length];
        try {
          const r = await fetchJSON(`http://127.0.0.1:${s.port}${s.health}`, 4000);
          latencies.push(r.ms);
          total++;
          if (r.status === 0 || r.status >= 500) errors5xx++;
          const body = r.body as Record<string, unknown> | undefined;
          if (body && typeof body === "object" && "code" in body && String(body.code).includes("53300")) errors53300++;
        } catch (e) {
          timeouts++;
          total++;
          const msg = String((e as Error).message || "");
          if (msg.includes("53300") || msg.includes("too_many_connections")) errors53300++;
        }
      }
    };

    const peakInterval = setInterval(() => {
      void pgStatActivityCount().then((n) => { lastPeak = Math.max(lastPeak, n); });
    }, 1500);

    const workers = Array.from({ length: conc }, (_, i) => worker(i));
    await Promise.all(workers);
    clearInterval(peakInterval);
    lastPeak = Math.max(lastPeak, await pgStatActivityCount()); // final read.

    const sorted = [...latencies].sort((a, b) => a - b);
    result.steps.push({
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
    lastPeak = await pgStatActivityCount(); // reset per step
  }

  // Recovery after pg_terminate_backend.
  const killed = await terminateBackend();
  await new Promise((r) => setTimeout(r, 1000));
  let alive = 0;
  for (const m of fleet.members) {
    const h = await healthStatus(m.port, m.health, 3000);
    if (h.status === 200) alive++;
  }
  result.recovery = {
    pg_terminate_backend: killed,
    alive_after: alive,
    of: fleet.members.length,
  };

  // Verdict — fail closed.
  const steps = result.steps;
  const checks: Array<{ id: string; detail: string; pass: boolean }> = [];

  const peakOverall = Math.max(...steps.map((s) => s.peak_pg_stat_activity), 0);
  checks.push({
    id: "PEAK_LE_34",
    detail: `peak pg_stat_activity = ${peakOverall} (worst case 17×2 = 34, simulated Supavisor ceiling 40)`,
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
    detail: `max p95 across all steps = ${steps.length ? Math.max(...steps.map((s) => s.p95_ms)) : 0} ms (SLO ≤ 500 ms, M4-03)`,
    pass: steps.length > 0 && Math.max(...steps.map((s) => s.p95_ms)) <= 500,
  });
  checks.push({
    id: "FLEET_STARTED",
    detail: `${fleet.members.length}/17 services started`,
    pass: fleet.members.length === 17,
  });
  checks.push({
    id: "RECOVERY",
    detail: `alive_after pg_terminate_backend = ${alive}/${fleet.members.length}`,
    pass: fleet.members.length > 0 && alive === fleet.members.length,
  });

  result.verdict.checks = checks;
  result.verdict.pass = checks.every((c) => c.pass);

  // Clean up.
  for (const m of fleet.members) {
    if (m.child.exitCode === null) {
      try { m.child.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }

  process.stdout.write(JSON.stringify(result, null, 2));
  process.exit(result.verdict.pass ? 0 : 1);
}

void main();

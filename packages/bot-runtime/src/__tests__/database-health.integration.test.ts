/**
 * CLM-0552 · RISK-0058 / ADR-059 on a live Postgres.
 *
 * `bot-database-health.test.ts` proves the /health hook with a `FakePool`. This file
 * proves it against the pool the bot really builds from `DATABASE_URL`: a reachable
 * database answers 200 `x-wasla-database: up`, an unreachable one answers 503 `down`.
 *
 * A separate file on purpose: the guard registry in `@wasla/resilience` is
 * process-wide and never forgets a pool, and vitest isolates modules per file — so
 * the probes here see only the pools this file creates.
 */

import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { MockChannelAdapter } from "@wasla/channel-core";

import { envNames, loadBotConfig, type EnvBag } from "../config.js";
import { attachBotDatabaseHealth } from "../http/server.js";
import { buildBotRuntime, type BotRuntime } from "../runtime.js";

const DATABASE_URL = process.env.DATABASE_URL;

function envFor(databaseUrl: string): EnvBag {
  const names = envNames("customer");
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: "a-sufficiently-long-secret",
    [names.miniAppUrl]: "https://apps.wasla.test/customer",
    [names.deepLinkTemplate]: "https://t.me/wasla_customer_bot?start={payload}",
    DATABASE_URL: databaseUrl,
  };
}

const runtimes: BotRuntime[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];

async function healthApp(databaseUrl: string) {
  runtimes.push(buildBotRuntime(loadBotConfig("customer", envFor(databaseUrl)), { channel: new MockChannelAdapter() }));
  const app = Fastify();
  app.get("/health", async () => ({ status: "ok", channel: "telegram" }));
  attachBotDatabaseHealth(app, "customer");
  apps.push(app);
  return app;
}

describe.skipIf(!DATABASE_URL)("bot /health probes the env-built Postgres pool (CLM-0552)", () => {
  afterAll(async () => {
    while (apps.length > 0) await apps.pop()!.close();
    while (runtimes.length > 0) await runtimes.pop()!.close();
  });

  it("answers 200 `x-wasla-database: up` when the bot's database is reachable", async () => {
    const app = await healthApp(DATABASE_URL!);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-wasla-database"]).toBe("up");
    expect(res.json()).toEqual({ status: "ok", channel: "telegram" });
  });

  it("answers 503 `x-wasla-database: down` once a pool in the process cannot reach its database", async () => {
    // Port 1 on loopback: nothing listens, so connect is refused immediately.
    const unreachable = new URL(DATABASE_URL!);
    unreachable.hostname = "127.0.0.1";
    unreachable.port = "1";
    const app = await healthApp(unreachable.toString());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["x-wasla-database"]).toBe("down");
    expect(res.json()).toMatchObject({ status: "unavailable", service: "customer-bot" });
  });
});

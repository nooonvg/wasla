/**
 * CLM-0552 · `db-integration (bot-runtime, @wasla/bot-runtime, wasla_bot_runtime_test)`.
 *
 * The unit suite (`runtime.test.ts` — "wires the Postgres stores when DATABASE_URL is
 * configured") proves only that `buildBotRuntime` *picks* the Postgres adapters: `pg`
 * opens sockets lazily, so no database is ever contacted there. What it cannot prove is
 * the property production sets `DATABASE_URL` for (runtime.ts, MR 5): that the composed
 * bot actually persists to `channel_updates` / `channel_deliveries` / `channel_outbox`,
 * and that de-duplication **survives a process restart** — the exact guarantee the
 * in-memory path loses. Those two questions need a live Postgres, so they live here.
 *
 * Nothing is mocked below the composition: the stores are the ones `buildBotRuntime`
 * builds from `DATABASE_URL` (no `stores` override). Only the outward edges — the
 * Telegram API and the identity service — are test doubles, exactly as in the unit
 * suite, so the difference between the two suites is the database and nothing else.
 *
 * Skipped as a whole when DATABASE_URL is unset (the default `pnpm -r test` excludes
 * this file anyway — see vitest.config.ts).
 *
 * Local run:
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/wasla_bot_runtime_test \
 *     pnpm --filter @wasla/bot-runtime test:integration
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";

import { envNames, loadBotConfig, type EnvBag } from "../config.js";
import { createBotApp } from "../http/app.js";
import { buildBotRuntime } from "../runtime.js";

import { authHeaders, createTestServiceIdentity, signFor, startUpdate } from "./harness.js";
import { adminPool, channelRowCounts, resetChannelSchema, truncateChannelTables } from "./pg-harness.js";

const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = "a-sufficiently-long-secret";

type Bot = "customer" | "driver" | "partner";

interface InjectOptions {
  readonly method: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly payload?: unknown;
}
/** The slice of a light-my-request response these tests read. */
interface InjectResult {
  readonly statusCode: number;
  json(): { status?: string } & Record<string, unknown>;
}

function envFor(bot: Bot): EnvBag {
  const names = envNames(bot);
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: SECRET,
    [names.miniAppUrl]: `https://apps.wasla.test/${bot}`,
    [names.deepLinkTemplate]: `https://t.me/wasla_${bot}_bot?start={payload}`,
    IDENTITY_SERVICE_URL: "http://identity:8080",
    WASLA_SERVICE_AUTH_KEYS: "test-active:active:bot-runtime-test-secret-0123456789",
    WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
    DATABASE_URL: DATABASE_URL ?? "",
  };
}

/** One bot "process": the real composition from env, Postgres stores included. */
function processFor(bot: Bot) {
  const config = loadBotConfig(bot, envFor(bot));
  const channel = new MockChannelAdapter();
  const identity = new FakeIdentityBootstrap();
  // No `stores` override: persistence is whatever buildBotRuntime derives from DATABASE_URL.
  const runtime = buildBotRuntime(config, { channel, identity });
  const app = createBotApp({
    deps: { bot: runtime.bot, inbound: runtime.inbound, outbound: runtime.outbound, launch: runtime.launch },
    serviceIdentity: createTestServiceIdentity(),
    webhookSecret: config.webhookSecret,
    health: () => (runtime.identityDegraded ? "degraded" : "ok"),
  });
  app.addHook("onClose", async () => {
    await runtime.close();
  });
  const inject = (options: InjectOptions): Promise<InjectResult> =>
    app.inject({
      ...options,
      headers: { ...signFor(options.method, options.url), ...(options.headers ?? {}) },
    } as never) as unknown as Promise<InjectResult>;
  return { app, runtime, channel, identity, inject };
}

const open: Array<{ app: { close: () => Promise<unknown> } }> = [];
async function closeAll(): Promise<void> {
  while (open.length > 0) await open.pop()!.app.close();
}

describe.skipIf(!DATABASE_URL)("bot-runtime on a live Postgres (CLM-0552)", () => {
  const admin = DATABASE_URL ? adminPool(DATABASE_URL) : undefined;

  beforeAll(async () => {
    await resetChannelSchema(admin!);
  });
  beforeEach(async () => {
    await truncateChannelTables(admin!);
  });
  afterEach(closeAll);
  afterAll(async () => {
    await closeAll();
    await admin?.end();
  });

  it("persists an end-to-end /start to the three channel tables through the env-built stores", async () => {
    const proc = processFor("driver");
    open.push(proc);
    expect(proc.runtime.persistence).toBe("postgres");

    const response = await proc.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(101),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("accepted");
    expect(proc.identity.calls).toHaveLength(1);
    expect(proc.channel.sent).toHaveLength(1);

    const updates = await admin!.query(
      "SELECT channel, bot, channel_update_id, kind, command FROM channel_updates",
    );
    expect(updates.rows).toEqual([
      { channel: "telegram", bot: "driver", channel_update_id: "101", kind: "command", command: "start" },
    ]);

    const deliveries = await admin!.query("SELECT bot, status, attempts FROM channel_deliveries");
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]).toMatchObject({ bot: "driver", status: "sent" });

    const counts = await channelRowCounts(admin!);
    expect(counts.outbox).toBeGreaterThan(0);
  });

  it("keeps de-duplication across a process restart — the guarantee the in-memory path loses", async () => {
    // First process receives update 202 and shuts down (pool released).
    const first = processFor("customer");
    const accepted = await first.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(202),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().status).toBe("accepted");
    await first.app.close();
    const afterFirst = await channelRowCounts(admin!);

    // A fresh process on the same database receives the same update again (Telegram retry).
    const second = processFor("customer");
    open.push(second);
    const replay = await second.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(202),
    });

    expect(replay.statusCode).toBe(202);
    expect(replay.json().status).toBe("duplicate");
    // Nothing re-ran: no second identity call, no second reply, no new rows anywhere.
    expect(second.identity.calls).toHaveLength(0);
    expect(second.channel.sent).toHaveLength(0);
    expect(await channelRowCounts(admin!)).toEqual(afterFirst);
  });

  it("scopes de-duplication per bot: the same Telegram update id on another bot is a new update", async () => {
    const customer = processFor("customer");
    const partner = processFor("partner");
    open.push(customer, partner);

    const a = await customer.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(303),
    });
    const b = await partner.inject({
      method: "POST",
      url: "/channel/partner/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(303),
    });

    expect(a.json().status).toBe("accepted");
    expect(b.json().status).toBe("accepted");
    const rows = await admin!.query("SELECT bot FROM channel_updates WHERE channel_update_id = '303' ORDER BY bot");
    expect(rows.rows.map((r: { bot: string }) => r.bot)).toEqual(["customer", "partner"]);
  });
});

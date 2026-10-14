/**
 * Postgres setup for the bot-runtime integration suite (CLM-0552).
 *
 * The bot never owns tables: it composes `@wasla/channel-postgres`, whose canonical DDL
 * is the core's contract (`packages/channel-core/contracts/schema.sql`). So the suite
 * applies that same file — never a copy — and starts every file from the published schema.
 *
 * The admin pool is built with `createChannelDb` so this package needs no direct `pg`
 * dependency of its own (it is reached only through `@wasla/channel-postgres`, as in
 * production).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createChannelDb } from "@wasla/channel-postgres";

export type AdminPool = ReturnType<typeof createChannelDb>["pool"];

/** Resolved from the package root (`pnpm --filter @wasla/bot-runtime test:integration`). */
export const CHANNEL_SCHEMA_SQL = resolve(process.cwd(), "../channel-core/contracts/schema.sql");

const CHANNEL_TABLES = "channel_outbox, channel_deliveries, channel_updates";

export function adminPool(connectionString: string): AdminPool {
  return createChannelDb({ connectionString, max: 1 }).pool;
}

export async function resetChannelSchema(pool: AdminPool): Promise<void> {
  const ddl = await readFile(CHANNEL_SCHEMA_SQL, "utf8");
  await pool.query(`DROP TABLE IF EXISTS ${CHANNEL_TABLES} CASCADE`);
  await pool.query(ddl);
}

export async function truncateChannelTables(pool: AdminPool): Promise<void> {
  await pool.query(`TRUNCATE ${CHANNEL_TABLES}`);
}

export async function channelRowCounts(
  pool: AdminPool,
): Promise<{ updates: number; deliveries: number; outbox: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM channel_updates)::int    AS updates,
            (SELECT count(*) FROM channel_deliveries)::int AS deliveries,
            (SELECT count(*) FROM channel_outbox)::int     AS outbox`,
  );
  return rows[0] as { updates: number; deliveries: number; outbox: number };
}

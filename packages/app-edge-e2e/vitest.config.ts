/**
 * Single config for the app-edge E2E suite (ADR-069 · CLM-0524 · المرحلة 2 الجزء 2).
 *
 * Like `packages/channel-e2e`, the `.e2e.test.ts` files are *deliberately included*
 * here: the E-18/E-19/E-20/E-01..E-17 evidence runs in every `pnpm -r test` against
 * in-memory stores, and setting `DATABASE_URL` lifts the same files onto Postgres.
 * A gate that can be skipped is not a gate.
 *
 * `fileParallelism: false` because the suite owns the schema of the target
 * database (drop + DDL, then truncate per test). Adding a second file cannot
 * silently start a race over the same tables.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
  },
});

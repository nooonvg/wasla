/**
 * Default vitest config — the unit suite only.
 *
 * Integration tests (`*.integration.test.ts`, CLM-0552) need a live Postgres and are
 * excluded from `pnpm -r test`, so the default pipeline stays green without a database.
 * They run in CI as `db-integration (bot-runtime, @wasla/bot-runtime, wasla_bot_runtime_test)`:
 *   DATABASE_URL=… pnpm --filter @wasla/bot-runtime test:integration
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/*.integration.test.ts"],
  },
});

/**
 * Integration vitest config — only the Postgres tests (CLM-0552). Requires DATABASE_URL;
 * every file skips itself when it is unset.
 *
 * `fileParallelism: false` is required, not a preference: the persistence file owns the
 * channel schema (DROP TABLE + canonical DDL) of the database, so parallel workers would
 * race on those tables.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.integration.test.ts"],
    fileParallelism: false,
  },
});

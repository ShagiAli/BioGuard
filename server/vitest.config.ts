import { defineConfig } from "vitest/config";

/**
 * Unit tests are pure and run anywhere. Integration tests need a
 * database, so they are a separate command — a contributor with no
 * Docker running can still verify the scheduling rules.
 */
export default defineConfig({
  test: {
    environment: "node",
    include:
      process.env.TEST_SCOPE === "integration"
        ? ["tests/api.test.ts"]
        : [
            "tests/rules.test.ts",
            "tests/guard.test.ts",
            "tests/scheduler-status.test.ts",
            "tests/alert-workflow.test.ts",
            "tests/cron-endpoint.test.ts",
          ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one database; running them in parallel
    // would have them deleting each other's fixtures.
    fileParallelism: false,
  },
});

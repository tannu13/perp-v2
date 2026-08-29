import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * These drive a real browser against a real stack: Postgres, Redis, the engine
 * and the backend must already be up (see docs/RUNBOOK.md). Only the Next dev
 * server is started here, because it is the one process this suite owns.
 *
 * Playwright needs Node 20+; the repo otherwise runs on Bun. Use
 * `bun run test:e2e`, which puts a suitable Node on PATH.
 */
const WEB_PORT = 3020;

export default defineConfig({
  testDir: "./e2e",
  /**
   * `.e2e.ts`, not `.spec.ts`: Bun's test runner claims `*.spec.*` as well as
   * `*.test.*`, so a bare `bun test` in this directory would try to execute
   * Playwright specs and fail with "Playwright Test did not expect test() to be
   * called here". Distinct extensions keep the two runners out of each other's
   * way whichever command someone types.
   */
  testMatch: "**/*.e2e.ts",
  // Serial: these share one backend and create real accounts and orders.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev",
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

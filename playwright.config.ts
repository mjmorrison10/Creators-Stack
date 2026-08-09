import { defineConfig, devices } from "@playwright/test";

/**
 * The suite runs against a real production build served at the real base path.
 *
 * That matters more here than it usually would: this app deploys to GitHub
 * Pages as a project site, so every asset URL, the hash router, and the
 * `import.meta.env.BASE_URL` fetches are all base-path-sensitive. A dev server
 * at `/` would pass while the deployed bundle 404s. `vite preview` serves
 * `dist/` under `/Creators-Stack/`, which is what actually ships.
 */
const PORT = 4173;
const BASE = "/Creators-Stack/";

export default defineConfig({
  testDir: "tests/e2e",
  // Storage state is the thing under test almost everywhere in this app, and
  // it is per-origin. Workers get separate browser contexts, so parallel is
  // safe — but a failing spec must not be retried into a dirty context.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    // CI installs its own browser and needs no override. Some sandboxed dev
    // environments ship a pre-installed Chromium at a fixed path and forbid
    // `playwright install`; point PLAYWRIGHT_CHROMIUM_PATH at it there.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? {
          channel: "chromium",
          launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
        }
      : {}),
    trace: "retain-on-failure",
    // No real network reaches a provider: every spec that needs one stubs it
    // by interception. This makes an unstubbed call fail loudly rather than
    // silently trying to leave the machine.
    serviceWorkers: "block",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

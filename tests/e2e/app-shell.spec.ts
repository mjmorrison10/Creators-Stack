// Phase 0 smoke check: serve dist at the real Pages base path and drive the
// app headlessly. Catches base-path, router, and theme-token regressions.
import { test, expect } from "@playwright/test";

// One test, not five: these checks share a single page whose state carries
// forward (route history, then a deep link, then a reload).
test("app shell serves, routes, and themes at the real base path", async ({ page, browser }) => {
  const errors: string[] = [];

  // Default context: headless chromium reports prefers-color-scheme: light.
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (!r.ok()) errors.push(`${r.status()} ${r.url()}`);
  });

  await test.step("index boots and redirects to the default section", async () => {
    await page.goto("./", { waitUntil: "networkidle" });

    expect(page.url().endsWith("#/recall"), "index redirects to #/recall").toBeTruthy();
    expect(
      (await page.getByRole("heading", { name: "RECALL" }).count()) === 1,
      "RECALL heading renders",
    ).toBeTruthy();
  });

  // Click through every section. waitFor() rather than an immediate count():
  // the hash changes synchronously but React commits a tick later.
  await test.step("Click through every section", async () => {
    for (const [name, hash] of [
      ["HOOKLAB", "#/hooklab"],
      ["BLAST", "#/blast"],
      ["PULSE", "#/pulse"],
      ["SETTINGS", "#/settings"],
    ] as const) {
      await page.getByRole("link", { name, exact: true }).click();
      await page.waitForURL(`**${hash}`);
      let ok = true;
      try {
        await page.getByRole("heading", { name }).waitFor({ state: "visible", timeout: 4000 });
      } catch {
        ok = false;
      }
      expect(ok, `${name} route renders its heading`).toBeTruthy();
    }
  });

  // Deep link + reload — the case history routing would 404 on.
  await test.step("Deep link + reload", async () => {
    await page.goto("#/blast", { waitUntil: "networkidle" });
    expect(
      (await page.getByRole("heading", { name: "BLAST" }).count()) === 1,
      "deep link #/blast survives reload",
    ).toBeTruthy();

    await page.goto("#/nope", { waitUntil: "networkidle" });
    expect(
      (await page.getByRole("heading", { name: "RECALL" }).count()) === 1,
      "unknown route falls back to RECALL",
    ).toBeTruthy();
  });

  // Static asset served from the base path (not root).
  await test.step("Static asset served from the base path (not root)", async () => {
    expect(
      (await page.request.get("arena-ranking.json")).ok(),
      "arena-ranking.json served at base path",
    ).toBeTruthy();
    expect(
      (await page.request.get("icons/icon-192.png")).ok(),
      "favicon resolves (no console 404)",
    ).toBeTruthy();
  });

  // Theme tokens: verify BOTH schemes and the data-theme override, rather than
  // assuming the runner's scheme. Light is what headless actually reports.
  await test.step("Theme tokens: verify BOTH schemes and the data-theme override", async () => {
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(
      lightBg === "rgb(245, 246, 248)",
      `light scheme uses light ground (got ${lightBg})`,
    ).toBeTruthy();

    // A second context is the only way to emulate the opposite scheme. It is
    // created off the `browser` fixture, so it does not inherit the project's
    // `use` options — baseURL has to be handed to it explicitly.
    const darkCtx = await browser.newContext({
      colorScheme: "dark",
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const darkPage = await darkCtx.newPage();
      await darkPage.goto("./", { waitUntil: "networkidle" });
      const darkBg = await darkPage.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(
        darkBg === "rgb(14, 17, 22)",
        `dark scheme uses dark ground (got ${darkBg})`,
      ).toBeTruthy();

      await darkPage.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "light"),
      );
      const forced = await darkPage.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(
        forced === "rgb(245, 246, 248)",
        `data-theme override beats the media query (got ${forced})`,
      ).toBeTruthy();
    } finally {
      await darkCtx.close();
    }
  });

  expect(errors.length === 0, "no console errors or failed requests").toBeTruthy();
});

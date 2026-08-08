// Phase 2 verification: seed the browser with legacy-shaped data exactly as the
// still-deployed apps would leave it, then drive the real Settings UI and prove
// the unified app reads it, backs it up, and round-trips it.
import { test, expect } from "@playwright/test";

// Data shaped the way the legacy apps actually write it.
const LEGACY = {
  hooklab_state_v1: JSON.stringify({
    ledger: [
      { id: "id_1", hook: "Nobody talks about this", outcome: "winner", createdAt: "2026-07-01T00:00:00.000Z" },
      { id: "pulse_p_abc", hook: "From pulse", outcome: "meh", createdAt: "2026-07-02T00:00:00.000Z", source: "pulse" },
    ],
    comps: [{ id: "c1", hook: "A competitor hook", createdAt: "2026-07-01T00:00:00.000Z" }],
  }),
  pulse_posts_v1: JSON.stringify([
    { id: "p_abc", platform: "TikTok", url: "https://tiktok.com/x", caption: "c", hook: "h",
      postedAt: 1750000000000, snapshots: [{ at: 1750003600000, elapsedMin: 60, views: 900, likes: null, comments: null, source: "manual" }],
      outcome: null, ledgerLoggedAt: null },
  ]),
  blast_queue_v1: JSON.stringify({
    v: 1, updatedAt: 1750000000000, defaultPlatforms: null, batchCount: 1,
    clips: [{ key: "quick", text: "base caption", platforms: null, captions: {}, titles: {},
      suggestions: {}, picked: {}, status: {}, postUrl: {}, postedAt: {}, postedCaption: {},
      createdAt: 1750000000000, updatedAt: 1750000000000 }],
  }),
  // Secrets and device prefs — must survive locally but never enter a sync payload.
  stack_settings_v1: JSON.stringify({ geminiKey: "AIzaLEAKCANARY", openrouterKey: "sk-LEAKCANARY" }),
  "blast-theme": "dark",
  blast_session_v1: JSON.stringify({ base: "stale projection", updatedAt: 1 }),
};

// One test, not one per section: the backup is downloaded from the state the
// theme checks above have already observed, and the theme switch writes over it.
test("Settings adopts legacy state, backs it up and round-trips it", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // Seed BEFORE the app boots, so it hydrates from pre-existing data.
  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  }, LEGACY);

  await page.goto("#/settings", { waitUntil: "networkidle" });

  expect((await page.getByRole("heading", { name: "SETTINGS" }).count()) === 1, "Settings renders").toBeTruthy();

  await test.step("The legacy theme must be adopted, not reset to system default", async () => {
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(themeAttr === "dark", `adopts the legacy blast-theme (got ${themeAttr})`).toBeTruthy();
    const seededKey = await page.evaluate(() => localStorage.getItem("stack_theme_v1"));
    expect(seededKey === '"dark"', `seeds stack_theme_v1 (got ${seededKey})`).toBeTruthy();
    const legacyUntouched = await page.evaluate(() => localStorage.getItem("blast-theme"));
    expect(legacyUntouched === "dark", "leaves the legacy theme key untouched").toBeTruthy();
  });

  await test.step("Existing API keys are readable in the form", async () => {
    const geminiVal = await page.locator('input[placeholder="AIza…"]').inputValue();
    expect(geminiVal === "AIzaLEAKCANARY", "reads the existing Gemini key from the shared store").toBeTruthy();
  });

  await test.step("Download a backup through the REAL engine and inspect it", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "DOWNLOAD BACKUP" }).click(),
    ]);
    const name = download.suggestedFilename();
    expect(
      /^mjm-stack-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name),
      `backup filename matches the legacy convention (${name})`,
    ).toBeTruthy();

    const stream = await download.createReadStream();
    let raw = "";
    for await (const chunk of stream) raw += chunk;
    const backup = JSON.parse(raw);

    expect(
      backup.format === "mjm-stack-backup" && backup.version === 2,
      "envelope is mjm-stack-backup v2",
    ).toBeTruthy();
    expect(JSON.parse(backup.localStorage.hooklab_state_v1).ledger.length === 2, "carries the hook ledger").toBeTruthy();
    expect(JSON.parse(backup.localStorage.pulse_posts_v1).length === 1, "carries the tracked posts").toBeTruthy();
    expect(JSON.parse(backup.localStorage.blast_queue_v1).clips.length === 1, "carries the posting queue").toBeTruthy();
    // A local file backup DOES keep keys (it's your own disk); only sync strips them.
    expect(
      backup.localStorage.stack_settings_v1 !== undefined,
      "local backup keeps API keys, as the legacy one does",
    ).toBeTruthy();
    expect(
      backup.localStorage.stack_sync_meta_v1 === undefined,
      "never exports device sync bookkeeping",
    ).toBeTruthy();
  });

  await test.step("The summary shown before a destructive restore must describe the real file", async () => {
    const summaryText = await page.locator("text=/Downloaded —/").textContent();
    expect(
      /ledger entr/i.test(summaryText ?? "") && /tracked post/i.test(summaryText ?? ""),
      `summary names the real contents (${summaryText?.trim()})`,
    ).toBeTruthy();
  });

  await test.step("Theme switching writes through the same layer", async () => {
    await page.getByRole("button", { name: "LIGHT" }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    expect(
      (await page.evaluate(() => localStorage.getItem("stack_theme_v1"))) === '"light"',
      "theme control writes stack_theme_v1",
    ).toBeTruthy();
  });

  await test.step("Other sections still render (no regression from the new imports)", async () => {
    await page.goto("#/recall", { waitUntil: "networkidle" });
    expect((await page.getByRole("heading", { name: "RECALL" }).count()) === 1, "RECALL still renders").toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors — ${errors.slice(0, 3).join(" | ")}`).toBeTruthy();
});

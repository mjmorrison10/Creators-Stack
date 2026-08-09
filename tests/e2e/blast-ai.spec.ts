// Verifies BLAST caption suggestions with the provider stubbed by network
// interception — including that the HOOKLAB evidence actually reaches the prompt.
import { test, expect } from "@playwright/test";

const WINNER = "Confidence comes after the work, never before it.";

// One test, not many: each section below depends on the page state and on the
// stubbed reply the previous section left behind.
test("BLAST suggestions use the ledger, never clobber the creator, and name provider failures", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  let prompts: string[] = [];
  let reply = JSON.stringify({ X: ["X option one", "X option two"], TikTok: ["TikTok option"] });
  await page.route("**generativelanguage.googleapis.com/**", async (route) => {
    if (route.request().url().includes(":generateContent")) {
      prompts.push(route.request().postData() ?? "");
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }] }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.addInitScript((winner) => {
    localStorage.setItem("stack_settings_v1", JSON.stringify({ geminiKey: "test-key-not-real" }));
    localStorage.setItem("blast_queue_v1", JSON.stringify({
      v: 1, updatedAt: 1754600000000, defaultPlatforms: null, batchCount: 1,
      clips: [{
        key: "quick", srcId: "", srcTitle: "", t: "", sec: 0,
        text: "Discipline is just remembering what you want.",
        hookText: "", label: "", platforms: ["X", "TikTok"],
        patternId: "", patternName: "", patternFamily: "",
        captions: {}, titles: {}, suggestions: {}, picked: {},
        status: {}, postUrl: {}, postedAt: {}, postedCaption: {},
        genState: "pending", genError: "", source: "quick",
        createdAt: 1754600000000, updatedAt: 1754600000000,
      }],
    }));
    localStorage.setItem("hooklab_state_v1", JSON.stringify({
      ledger: [{ id: "id_1", hook: winner, outcome: "winner", family: "identity",
                 platform: "tiktok", medium: "video", createdAt: "2026-07-01T00:00:00.000Z" }],
      comps: [],
    }));
  }, WINNER);

  const body = () => page.locator("main").textContent().then((t) => t ?? "");
  const session = () => page.evaluate(() => JSON.parse(localStorage.getItem("blast_session_v1") ?? "null"));

  await page.goto("#/blast", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "BLAST" }).waitFor();

  await test.step("the page says it is leaning on the ledger", async () => {
    expect((await body()).includes("1 winning hook"), "says it is leaning on the ledger").toBeTruthy();
  });

  await test.step("the prompt carries the ledger evidence and the selected platforms", async () => {
    await page.getByRole("button", { name: /SUGGEST FOR 2 PLATFORMS/ }).click();
    await page.locator("main").getByText(/Suggestions ready/).waitFor({ timeout: 20000 });

    expect(prompts.length === 1, "calls the provider once").toBeTruthy();
    expect(
      prompts[0]!.includes("Confidence comes after the work"),
      "puts the creator's winning hook in the prompt",
    ).toBeTruthy();
    // selectedNames returns display order, not the order they were stored in.
    expect(prompts[0]!.includes("TikTok, X"), "names the selected platforms — no TikTok, X").toBeTruthy();
    expect(!prompts[0]!.includes("LinkedIn"), "does not name unselected platforms").toBeTruthy();
    expect(prompts[0]!.includes("ABSOLUTE"), "states the hard cap as absolute").toBeTruthy();
    expect(prompts[0]!.includes("never invent claims"), "still forbids inventing claims").toBeTruthy();
  });

  await test.step("suggest stores the options and leaves the caption alone", async () => {
    const s1 = await session();
    expect(s1.suggestions.X.length === 2, "stores the returned options").toBeTruthy();
    // Legacy's SUGGEST path stores the options and leaves the caption alone —
    // the creator picks a chip. Auto-applying would silently overwrite whatever
    // they had written.
    expect(
      s1.captions.X === undefined || s1.captions.X === "",
      "does NOT overwrite the caption on suggest",
    ).toBeTruthy();
    expect(s1.picked.X === undefined, "clears any stale pick").toBeTruthy();
    expect(
      (await page.getByRole("button", { name: "X option one", exact: true }).count()) === 1,
      "renders the options as pickable chips",
    ).toBeTruthy();
  });

  await test.step("Picking a chip is what writes the caption.", async () => {
    await page.getByRole("button", { name: "X option two", exact: true }).click();
    await page.waitForTimeout(250);
    const picked = await session();
    expect(
      picked.captions.X === "X option two",
      `picking a chip writes that caption — ${picked.captions.X}`,
    ).toBeTruthy();
    expect(
      picked.picked.X === 1,
      `and records which one was picked — ${String(picked.picked.X)}`,
    ).toBeTruthy();
  });

  await test.step("A caption the creator already wrote must not be overwritten.", async () => {
    await page.getByLabel("X caption").fill("Mine, hands off");
    await page.waitForTimeout(250);
    prompts = [];
    await page.getByRole("button", { name: /SUGGEST FOR 2 PLATFORMS/ }).click();
    await page.locator("main").getByText(/Suggestions ready/).waitFor({ timeout: 20000 });
    expect(
      (await session()).captions.X === "Mine, hands off",
      "never overwrites a caption the creator wrote",
    ).toBeTruthy();
  });

  await test.step("A truncated reply must keep what arrived and say so.", async () => {
    reply = '{"X":["salvaged one"],"TikTok":["cut off he';
    prompts = [];
    await page.getByRole("button", { name: /SUGGEST FOR 2 PLATFORMS/ }).click();
    await page.locator("main").getByText(/cut short|Got captions/).waitFor({ timeout: 20000 });
    expect(
      (await session()).suggestions.X[0] === "salvaged one",
      "keeps the platforms that arrived in a truncated reply",
    ).toBeTruthy();
    expect((await body()).includes("cut short"), "says the reply was cut short").toBeTruthy();
  });

  await test.step("A rate limit returned as prose with a 200 must be named for what it is.", async () => {
    reply = "Rate limit exceeded, please try again later.";
    await page.getByRole("button", { name: /SUGGEST FOR 2 PLATFORMS/ }).click();
    await page.locator("main").getByText(/rate limited/i).waitFor({ timeout: 20000 });
    expect(
      (await body()).toLowerCase().includes("rate limited"),
      "names a prose rate-limit reply as a rate limit",
    ).toBeTruthy();
  });

  expect(
    errors.length === 0,
    `no console or page errors — ${errors.slice(0, 3).join(" | ")}`,
  ).toBeTruthy();
});

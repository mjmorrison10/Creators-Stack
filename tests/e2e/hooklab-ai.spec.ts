// Phase 7b: HOOKLAB's AI path, with the provider stubbed by interception.
//
// The case that matters: a reply carrying one good hook, one bogus patternId,
// and no CTAs. The bogus one must be DROPPED — never shown with a win rate and
// a badge it never earned — the missing patterns must backfill as scaffold
// fills, and the CTAs must come from the offline builder.
import { test, expect } from "@playwright/test";

// One test, not one per section: the second generation is asserted against the
// state the first one left behind, so the steps cannot be split or reordered.
test("HOOKLAB's AI path drops unearned provenance and backfills honestly", async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // A ledger with real winners, so a "PROVEN FOR YOU" badge is reachable and the
  // prompt has a personal sample to carry.
  await page.addInitScript(() => {
    if (localStorage.getItem("__seeded")) return;
    localStorage.setItem("__seeded", "1");
    localStorage.setItem("stack_settings_v1", JSON.stringify({
      geminiKey: "AIzaTESTKEY0000000000000",
    }));
    // HOOKLAB's own blob still carries the brand voice for a migrating user.
    localStorage.setItem("hooklab_settings_v1", JSON.stringify({
      provider: "gemini", geminiKey: "", openrouterKey: "", openrouterModel: "",
      brandVoice: "plain, no hype, no exclamation marks",
    }));
    localStorage.setItem("hooklab_state_v1", JSON.stringify({
      ledger: Array.from({ length: 4 }, (_, i) => ({
        id: `id_${i}`, hook: `a logged winner ${i}`, patternId: "", family: "curiosity",
        outcome: "winner", platform: "tiktok", medium: "video", niche: "general",
        retention: "", views: "50000", notes: "", createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      })),
      comps: [],
    }));
  });

  let prompt = "";
  let reply: string | null = null;
  await page.route("**generativelanguage.googleapis.com**", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    prompt = body?.contents?.[0]?.parts?.[0]?.text ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
    });
  });

  await page.goto("#/hooklab", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "HOOKLAB" }).waitFor();
  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  await test.step("the brief before anything is generated", async () => {
    expect((await body()).includes("NOTHING UNDERWRITTEN YET"), "the pre-generation state is shown").toBeTruthy();
    expect(
      (await page.getByLabel(/^Source material/).count()) === 1,
      "the brief asks for source material",
    ).toBeTruthy();
    expect((await page.getByLabel(/^Goal/).count()) === 1, "and for a goal").toBeTruthy();

    await page.getByLabel(/^Topic/).fill("why most hooks fail");
    await page.getByLabel(/^Source material/).fill("I tested 40 hooks last month and 3 carried the clip.");
  });

  await test.step("One hook naming a pattern that does not exist, and no ctas at all", async () => {
    reply = JSON.stringify({
      hooks: [
        { patternId: "definitely-not-a-real-pattern", text: "AN ORPHAN HOOK", grounding: "nothing" },
      ],
      ctas: [],
    });

    await page.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page.locator("main").getByText(/RESULTS —/).waitFor({ timeout: 20000 });

    expect(prompt.length > 0, "the provider was actually called").toBeTruthy();
    expect(/Never invent fake statistics/i.test(prompt), "the prompt forbids inventing proof").toBeTruthy();
    expect(prompt.includes("personalLedgerSample"), "the prompt carries the creator's own ledger").toBeTruthy();
    expect(
      prompt.includes("I tested 40 hooks last month"),
      "the prompt carries the source material",
    ).toBeTruthy();

    expect(prompt.includes("plain, no hype"), "the prompt carries the creator's brand voice").toBeTruthy();

    expect(!(await body()).includes("AN ORPHAN HOOK"), "the orphan hook is DROPPED, not shown").toBeTruthy();
    expect(
      /named no pattern|none named a pattern/.test(await body()),
      "and the drop is REPORTED, not passed off as an offline run",
    ).toBeTruthy();
    expect((await body()).includes("RESULTS —"), "every slot still produced a candidate").toBeTruthy();
    expect((await body()).includes("SCAFFOLD FILL"), "they are labelled as scaffold fills").toBeTruthy();
    expect(!(await body()).includes("AI DRAFT"), "no candidate claims to be an AI draft").toBeTruthy();
    expect((await body()).includes("GROUNDED IN"), "grounding is stated for each").toBeTruthy();

    // CTAs came back empty, so the offline builder must have supplied them.
    await page.getByRole("button", { name: /^CTAS 3$/ }).click();
    expect(
      (await page.locator("main ul li").count()) === 3,
      "offline CTAs were built when the model returned none",
    ).toBeTruthy();

    await page.getByRole("button", { name: /^ANGLES/ }).click();
    expect((await body()).includes("CANDIDATE"), "angles are summarized").toBeTruthy();
  });

  await test.step("now a reply the model wrote properly, naming a real pattern", async () => {
    await page.getByRole("button", { name: /^HOOKS/ }).click();
    const provenance =
      (await page
        .locator("main ul li")
        .first()
        .locator("span")
        .filter({ hasText: "·" })
        .first()
        .textContent()) ?? "";
    expect(provenance.split("·").length === 3, "a card names its pattern, family and tier").toBeTruthy();

    // Re-run naming that pattern. attachHooks resolves `patternId` against ids
    // first and pattern NAMES second, so a paraphrasing model still lands.
    const patternName = provenance.split("·")[0]!.trim();
    reply = JSON.stringify({
      hooks: [
        { patternId: patternName, text: "THE MODEL WROTE THIS ONE", grounding: "the transcript" },
      ],
      ctas: [{ id: "not-a-real-cta", text: "COMMENT THE WORD STACK" }],
    });
    await page.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page.waitForTimeout(500);
    const second = await body();
    expect(second.includes("THE MODEL WROTE THIS ONE"), "a hook matched by NAME is kept").toBeTruthy();
    expect(second.includes("AI DRAFT"), "and it is labelled an AI draft").toBeTruthy();
    expect(second.includes("SCAFFOLD FILL"), "the other patterns still backfill as scaffold fills").toBeTruthy();

    await page.getByRole("button", { name: /^CTAS/ }).click();
    expect(
      (await body()).includes("COMMENT THE WORD STACK"),
      "an unknown cta id falls back to the first cta rather than vanishing",
    ).toBeTruthy();
  });

  await test.step("A generation must survive a trip to the ledger and back", async () => {
    // A generation must survive a trip to the ledger and back — thinking is on by
    // default, so checking a past outcome mid-wait is a normal thing to do.
    await page.getByRole("tab", { name: /^LEDGER/ }).click();
    await page.getByRole("tab", { name: /^GENERATE/ }).click();
    expect((await body()).includes("RESULTS —"), "results survive a tab switch").toBeTruthy();
    expect(
      (await page.getByRole("button", { name: /^CTAS/ }).getAttribute("aria-pressed")) === "true",
      "down to the inner tab the user left it on",
    ).toBeTruthy();
    await page.getByRole("button", { name: /^HOOKS/ }).click();
    expect((await body()).includes("THE MODEL WROTE THIS ONE"), "and the drafted hook itself").toBeTruthy();
    expect(
      (await page.getByLabel(/^Topic/).inputValue()) === "why most hooks fail",
      "and so does the brief",
    ).toBeTruthy();
  });

  await test.step("with no key at all, the offline path must say it is offline", async () => {
    // A fresh context has none of the seeded state, so there is no API key.
    // `browser.newContext()` does not inherit the config's `use` block, so the
    // baseURL that makes `goto("#/hooklab")` resolve has to be handed over.
    const ctx2 = await browser.newContext({ baseURL });
    const page2 = await ctx2.newPage();
    page2.on("pageerror", (e) => errors.push(String(e)));
    await page2.goto("#/hooklab", { waitUntil: "networkidle" });
    await page2.getByLabel(/^Topic/).fill("no key here");
    await page2.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page2.getByText(/RESULTS —/).waitFor({ timeout: 10000 });
    const offlineBody = (await page2.locator("main").textContent()) ?? "";
    expect(
      /no API key set/i.test(offlineBody),
      "a keyless run says so instead of looking like a failed AI run",
    ).toBeTruthy();
    expect(offlineBody.includes("SCAFFOLD FILL"), "and every card is honestly labelled").toBeTruthy();
    expect(!offlineBody.includes("AI DRAFT"), "with no AI DRAFT badge anywhere").toBeTruthy();
    await ctx2.close();
  });

  expect(errors.length === 0, `no console or page errors — ${errors.slice(0, 3).join(" | ")}`).toBeTruthy();
});

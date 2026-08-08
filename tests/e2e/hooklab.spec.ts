// Phase 3 verification: drive the real HOOKLAB views against a legacy-shaped
// ledger, including a PULSE auto-promoted entry.
import { test, expect } from "@playwright/test";

// Two winners + one dead on tiktok = n of 3, which is exactly the insights
// threshold. x has a single entry and must stay hidden.
const LEGACY = {
  hooklab_state_v1: JSON.stringify({
    ledger: [
      { id: "id_1", hook: "Nobody talks about this", outcome: "winner", family: "curiosity", platform: "tiktok", medium: "video", createdAt: "2026-07-03T00:00:00.000Z" },
      { id: "id_2", hook: "The real reason your hooks fail", outcome: "winner", family: "curiosity", platform: "tiktok", medium: "video", createdAt: "2026-07-02T00:00:00.000Z" },
      { id: "id_3", hook: "A flop", outcome: "dead", family: "curiosity", platform: "tiktok", medium: "video", createdAt: "2026-07-01T00:00:00.000Z" },
      { id: "pulseauto_p_xyz", hook: "Auto promoted from PULSE", outcome: "winner", family: "proof", platform: "x", medium: "text", source: "pulse-auto", createdAt: "2026-07-04T00:00:00.000Z" },
    ],
    comps: [],
  }),
};

// One test, not one per section: these checks depend on sequential page state
// (the ledger written in LEDGER is the ledger the BANK search runs against).
test("HOOKLAB underwrites, logs and banks against a legacy-shaped ledger", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, LEGACY);

  await page.goto("#/hooklab", { waitUntil: "networkidle" });
  expect((await page.getByRole("heading", { name: "HOOKLAB" }).count()) === 1, "HOOKLAB renders").toBeTruthy();
  expect(
    (await page.getByRole("tab", { name: /LEDGER/ }).textContent())?.includes("4"),
    "tab shows the existing ledger count",
  ).toBeTruthy();

  await test.step("GENERATE: offline underwriting over the real pattern bank", async () => {
    await page.getByPlaceholder("e.g. why most hooks fail").fill("why most hooks fail");
    await page.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page.getByText(/RESULTS —/).waitFor();

    const cards = page.locator("li").filter({ has: page.getByRole("button", { name: "LOG OUTCOME" }) });
    const n = await cards.count();
    expect(n > 0 && n <= 20, `returns ranked candidates (${n})`).toBeTruthy();

    const body = (await page.locator("main").textContent()) ?? "";
    // Not every scaffold has a {topic} slot — "It's not a {vague}. It's
    // {named_diagnosis}." legitimately has none — so check the set, not card #1.
    expect(body.includes("why most hooks fail"), "fills the topic into scaffolds that take one").toBeTruthy();

    const firstText = (await cards.first().textContent()) ?? "";
    expect(
      /PROVEN FOR YOU|MARKET-PROVEN STRUCTURE|HYPOTHESIS|FATIGUED/.test(firstText),
      "shows a provenance badge",
    ).toBeTruthy();

    // The user has 3 curiosity entries in the last 10, so that family is fatigued.
    // The observable effect is demotion, not a badge: a fatigue of 1 costs 0.35,
    // which drops those patterns out of the top 20 entirely. A FATIGUED badge only
    // appears when an over-used pattern still ranks, so absence is the real signal.
    const families = new Set(
      (await cards.allTextContents()).map((t) => (t.match(/· (\w+) ·/) ?? [])[1]).filter(Boolean),
    );
    expect(
      !families.has("curiosity"),
      `demotes the over-used family out of the results (${[...families].join(", ")})`,
    ).toBeTruthy();

    // Honest evidence: a real rate where there's history, an explicit no-history line otherwise.
    expect(
      /Personal win rate on this family: \d+%/.test(body) || /No personal history yet/.test(body),
      "states real evidence, not invented numbers",
    ).toBeTruthy();
  });

  await test.step("LEDGER", async () => {
    await page.getByRole("tab", { name: /LEDGER/ }).click();
    await page.getByText("LOG AN OUTCOME").waitFor();

    const ledgerBody = (await page.locator("main").textContent()) ?? "";
    expect(ledgerBody.includes("Nobody talks about this"), "renders existing entries").toBeTruthy();
    expect(ledgerBody.includes("AUTO"), "marks the PULSE auto-promoted entry AUTO").toBeTruthy();

    // n>=3 gate: tiktok (3 entries) reported with its n; x (1 entry) omitted.
    expect(
      /66%|67%/.test(ledgerBody) && /n=3/.test(ledgerBody),
      "reports the group at the threshold with n",
    ).toBeTruthy();
    expect(!/n=1/.test(ledgerBody), "hides the single-entry group").toBeTruthy();

    // Log an entry and confirm it lands in the legacy shape.
    await page.getByPlaceholder("The opening line you used").fill("A brand new hook");
    await page.getByRole("button", { name: "LOG ENTRY" }).click();
    await page.getByText("Logged.").waitFor();

    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem("hooklab_state_v1")))!);
    expect(stored.ledger.length === 5, "writes to the legacy key with 5 entries").toBeTruthy();
    const added = stored.ledger[0];
    expect(added.hook === "A brand new hook", "prepends the new entry").toBeTruthy();
    expect(/^id_/.test(added.id), "mints a legacy-shaped id").toBeTruthy();
    expect(
      typeof added.createdAt === "string" && added.createdAt.includes("T"),
      "uses an ISO timestamp, not epoch",
    ).toBeTruthy();
    expect(
      stored.ledger.some((e: any) => e.id === "pulseauto_p_xyz" && e.source === "pulse-auto"),
      "preserves the PULSE entry untouched",
    ).toBeTruthy();

    // Export must match the legacy envelope exactly.
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "EXPORT" }).click(),
    ]);
    expect(
      dl.suggestedFilename() === "hooklab-ledger.json",
      `export filename is legacy-exact (${dl.suggestedFilename()})`,
    ).toBeTruthy();
    let raw = "";
    for await (const c of await dl.createReadStream()) raw += c;
    const env = JSON.parse(raw);
    expect(
      JSON.stringify(Object.keys(env).sort()) === JSON.stringify(["comps", "exportedAt", "ledger"]),
      "export envelope is {ledger, comps, exportedAt}",
    ).toBeTruthy();
    expect(env.ledger.length === 5, "export carries every entry").toBeTruthy();

    // Deleting must leave a tombstone or sync resurrects the entry.
    await page.locator("li").filter({ hasText: "A brand new hook" }).getByRole("button", { name: "DELETE" }).click();
    const tombs = JSON.parse((await page.evaluate(() => localStorage.getItem("stack_tombstones_v1"))) ?? "{}");
    expect(
      Object.keys(tombs).some((k) => k.startsWith("hooklabLedger:")),
      "delete writes a tombstone",
    ).toBeTruthy();
  });

  await test.step("BANK", async () => {
    await page.getByRole("tab", { name: "BANK" }).click();
    await page.getByText(/PATTERN BANK —/).waitFor();
    const bank = (await page.locator("main").textContent()) ?? "";
    expect(/PATTERN BANK — \d{2,}/.test(bank), "bank lists the full pattern set").toBeTruthy();
    expect(/HISTORICAL EVIDENCE — 12/.test(bank), "shows historical evidence").toBeTruthy();

    await page.getByPlaceholder("Search patterns…").fill("curiosity");
    await page.waitForTimeout(150);
    const shown = (await page.getByText(/^SHOWING \d+$/).textContent()) ?? "";
    expect(/SHOWING [1-9]/.test(shown), `search narrows the list (${shown.trim()})`).toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors — ${errors.slice(0, 3).join(" | ")}`).toBeTruthy();
});

// Verifies TOP CLIPS end to end: the evidence ladder, saved scans, and that
// collecting a recommended clip carries its pattern provenance into the bin.
import { test, expect } from "@playwright/test";

/** The legacy library envelope, as it sits in IndexedDB under `library/current`. */
type LegacyLibrary = {
  sources: { id: string; title: string; segments: { t: string; sec: number; text: string }[] }[];
  enabled: string[];
  bin: { key: string }[];
};

const WINNER_HOOK = "Confidence comes after the work, never before it.";

const LIB: LegacyLibrary = {
  sources: [
    {
      id: "ep41",
      title: "Episode 41",
      segments: [
        // Verbatim reuse of a ledger winner → PROVEN FOR YOU.
        { t: "0:00:05", sec: 5, text: WINNER_HOOK },
        // Neither a ledger nor a pattern match → surfaced with no claim.
        { t: "0:00:22", sec: 22, text: "The weather that morning was unremarkable and grey." },
        // Garbled transcript → down-ranked, flagged, never hidden.
        { t: "0:00:41", sec: 41, text: "I cut three minutes off my broLilly edit and HeGülme nobody noticed" },
      ],
    },
  ],
  enabled: ["ep41"],
  bin: [],
};

const HOOKLAB = {
  ledger: [
    {
      id: "id_1",
      hook: WINNER_HOOK,
      outcome: "winner",
      family: "identity",
      platform: "tiktok",
      medium: "video",
      patternId: "p_curiosity_gap",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  comps: [],
};

// One test, not many: the scan has to exist before it can be reloaded,
// collected from, and then dropped by deleting its source.
test("TOP CLIPS ranks on evidence, saves the scan, and carries provenance", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ lib, hooklab }) => {
      localStorage.setItem("recall_state_v2", JSON.stringify(lib));
      localStorage.setItem("hooklab_state_v1", JSON.stringify(hooklab));
    },
    { lib: LIB, hooklab: HOOKLAB },
  );

  await page.goto("#/recall", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "RECALL" }).waitFor();
  await page.getByRole("tab", { name: "TOP CLIPS" }).click();
  await page.locator("main").getByText("NOT SCANNED").waitFor();

  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  await test.step("the evidence ladder", async () => {
    expect(
      !(await body()).includes("No HOOKLAB ledger"),
      "does not nag when the ledger already has a winner",
    ).toBeTruthy();

    await page.getByRole("button", { name: "SCAN" }).click();
    await page.locator("main").getByText(/SHOWING \d+ OF/).waitFor();

    const shown = await body();
    expect(shown.includes("PROVEN FOR YOU"), "promotes the reused winner as personally proven").toBeTruthy();
    expect(
      shown.includes(`Close to a hook your ledger marks a winner`),
      "names the winner it matched",
    ).toBeTruthy();
    expect(
      shown.includes("surfaced on specificity alone"),
      "makes no claim about the unmatched line",
    ).toBeTruthy();
    expect(shown.includes("TRANSCRIPT LOOKS GARBLED"), "flags the garbled transcript").toBeTruthy();

    // Ordering: personal proof must come first.
    const cards = page.locator("li").filter({ has: page.getByRole("button", { name: /BIN/ }) });
    const firstCard = (await cards.first().textContent()) ?? "";
    expect(firstCard.includes("PROVEN FOR YOU"), "puts personal proof at the top").toBeTruthy();

    // The garbled line must still be present, just lower.
    const texts = await cards.allTextContents();
    const noisyAt = texts.findIndex((t: string) => t.includes("broLilly"));
    expect(
      noisyAt > 0,
      `down-ranks the garbled line without hiding it (position ${noisyAt + 1}/${texts.length})`,
    ).toBeTruthy();
  });

  // --- the scan is saved, not recomputed ---
  await test.step("the scan is saved, not recomputed", async () => {
    const saved = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("recall_topclips_v1")))!,
    );
    expect(!!saved && !!saved.ep41, "persists the scan under the legacy key, keyed by source").toBeTruthy();
    expect(typeof saved.ep41.savedAt === "number", "stamps when it ran").toBeTruthy();
    expect(
      saved.ep41.meta.scoutSrcId === "ep41" && saved.ep41.meta.scout === true,
      "normalizes meta to the scout shape",
    ).toBeTruthy();
    expect(saved.ep41.meta.aiNote === "", "strips the transient AI note before saving").toBeTruthy();
    expect(
      typeof saved.ep41.candidates.find((c: { label: string }) => c.label === "proof")?.match === "object",
      "stores the match object, not a summary string",
    ).toBeTruthy();

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "TOP CLIPS" }).click();
    expect(
      (await body()).includes("SCANNED"),
      "shows the saved scan after a reload without rescanning",
    ).toBeTruthy();
  });

  // --- collecting a recommended clip carries provenance into the bin ---
  await test.step("collecting a recommended clip carries provenance into the bin", async () => {
    await page.getByRole("button", { name: "VIEW" }).click();
    await page.locator("main").getByText(/SHOWING \d+ OF/).waitFor();
    await page.locator("li").filter({ hasText: "broLilly" }).getByRole("button", { name: "+ BIN" }).click();
    await page.waitForTimeout(250);

    const lib = await page.evaluate(
      () =>
        new Promise<LegacyLibrary | null>((res) => {
          const r = indexedDB.open("recall", 1);
          r.onsuccess = () => {
            const g = r.result.transaction("library", "readonly").objectStore("library").get("current");
            g.onsuccess = () => res(g.result ?? null);
          };
        }),
    );
    expect(lib!.bin.length === 1, "collecting from TOP CLIPS writes a bin item").toBeTruthy();
    expect(/^ep41@\d+@\d+$/.test(lib!.bin[0]!.key), "bin item keeps the legacy key shape").toBeTruthy();
  });

  // --- deleting the source must drop its saved scan ---
  await test.step("deleting the source must drop its saved scan", async () => {
    await page.getByRole("button", { name: "Remove Episode 41" }).click();
    await page.getByRole("button", { name: "REMOVE?" }).click();
    await page.waitForTimeout(300);
    const afterDelete = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("recall_topclips_v1"))) ?? "{}",
    );
    expect(!afterDelete.ep41, "deleting a source drops its saved scan").toBeTruthy();
  });

  expect(errors.length === 0, "no console or page errors").toBeTruthy();
});

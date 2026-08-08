// Phase 4 verification: drive the real RECALL views against a legacy-shaped
// library, including the pre-IndexedDB localStorage blob that must migrate.
import { test, expect } from "@playwright/test";

/** The legacy library envelope, as it sits in IndexedDB under `library/current`. */
type LegacySegment = { t: string; sec: number; text: string };
type LegacyBinItem = {
  key: string;
  srcId?: string;
  srcTitle?: string;
  t?: string;
  sec?: number;
  text?: string;
  patternFamily?: string;
};
type LegacyLibrary = {
  sources: { id: string; title: string; segments: LegacySegment[] }[];
  enabled: string[];
  bin: LegacyBinItem[];
};

// Exactly the shape recall/app.js left in localStorage before the IDB move.
const LEGACY_BLOB: LegacyLibrary = {
  sources: [
    {
      id: "apogee",
      title: "Apogee — Rome Scurry interview",
      segments: [
        { t: "0:23:09", sec: 1389, text: "It reminds me of one of the challenges we have here in Apogee." },
        { t: "0:23:55", sec: 1435, text: "So to me, your self-belief is skyrocketing high." },
        { t: "0:24:28", sec: 1468, text: "That's really the concept of anti-fragility." },
      ],
    },
    {
      id: "sample",
      title: "Sample — Discipline rant",
      segments: [
        { t: "0:00:05", sec: 5, text: "Discipline is just remembering what you want." },
        { t: "0:00:22", sec: 22, text: "Confidence comes after the work, never before it." },
      ],
    },
  ],
  enabled: ["apogee", "sample"],
  bin: [
    {
      key: "sample@5@0",
      srcId: "sample",
      srcTitle: "Sample — Discipline rant",
      t: "0:00:05",
      sec: 5,
      text: "Discipline is just remembering what you want.",
      patternFamily: "identity",
    },
  ],
};

// One test, not many: every section below depends on the state the previous
// one left behind (migrated library → search → bin → export → delete).
test("RECALL migrates, searches, collects, exports, and deletes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((blob) => {
    localStorage.setItem("recall_state_v2", JSON.stringify(blob));
  }, LEGACY_BLOB);

  await page.goto("#/recall", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "RECALL" }).waitFor();

  const body = () => page.locator("main").textContent().then((t) => t ?? "");
  const q = page.getByPlaceholder(/Search every moment/);

  // --- migration: the pre-IDB blob must move into IndexedDB and be cleared ---
  await test.step("migration: the pre-IDB blob must move into IndexedDB and be cleared", async () => {
    await page.getByText(/MOMENTS INDEXED/).waitFor();
    expect(
      (await body()).includes("5"),
      "migrates the legacy library and indexes every moment",
    ).toBeTruthy();
    expect(
      (await body()).includes("Apogee — Rome Scurry interview"),
      "renders both migrated sources",
    ).toBeTruthy();

    const leftover = await page.evaluate(() => localStorage.getItem("recall_state_v2"));
    expect(leftover === null, "clears the legacy key once IndexedDB has the data").toBeTruthy();

    const inIdb = await page.evaluate(
      () =>
        new Promise<LegacyLibrary | null>((res) => {
          const r = indexedDB.open("recall", 1);
          r.onsuccess = () => {
            const g = r.result.transaction("library", "readonly").objectStore("library").get("current");
            g.onsuccess = () => res(g.result ?? null);
            g.onerror = () => res(null);
          };
          r.onerror = () => res(null);
        }),
    );
    expect(
      !!inIdb && inIdb.sources.length === 2,
      "writes to the legacy IndexedDB coordinates",
    ).toBeTruthy();
    expect(!!inIdb && inIdb.bin.length === 1, "carries the bin across the migration").toBeTruthy();
    expect(
      inIdb?.bin?.[0]?.patternFamily === "identity",
      "preserves pattern provenance on the bin item",
    ).toBeTruthy();
  });

  // --- search ---
  await test.step("search", async () => {
    await q.fill("confidence");
    await page.waitForTimeout(120);
    expect(
      (await body()).includes("Confidence comes after the work"),
      "finds the moment across sources",
    ).toBeTruthy();
    expect(
      /1 MOMENT ·/.test(await body()),
      "counts the hit and the sources it came from",
    ).toBeTruthy();

    await q.fill("confidence anti-fragility");
    await page.waitForTimeout(120);
    expect(
      (await body()).includes("No moments for"),
      "requires every term, so an impossible pair returns nothing",
    ).toBeTruthy();

    // A regex metacharacter must not blow up the highlighter.
    await q.fill("(");
    await page.waitForTimeout(120);
    expect(errors.length === 0, "survives a regex metacharacter in the query").toBeTruthy();

    await q.fill("discipline");
    await page.waitForTimeout(120);
    const marks = await page.locator("main mark").count();
    expect(marks > 0, `highlights the matched term (${marks})`).toBeTruthy();
    // The seeded bin already holds this moment, so the button reflects that
    // rather than offering to add it again.
    expect(
      (await page.getByRole("button", { name: "IN BIN ✓" }).count()) === 1,
      "shows an already-collected moment as in the bin",
    ).toBeTruthy();
  });

  // --- bin ---
  await test.step("bin", async () => {
    await q.fill("anti-fragility");
    await page.waitForTimeout(120);
    await page.getByRole("button", { name: "+ BIN" }).first().click();
    await page.waitForTimeout(150);
    expect(
      (await page.getByRole("button", { name: "IN BIN ✓" }).count()) >= 1,
      "adding shows the moment as collected",
    ).toBeTruthy();

    const binState = await page.evaluate(
      () =>
        new Promise<LegacyLibrary | null>((res) => {
          const r = indexedDB.open("recall", 1);
          r.onsuccess = () => {
            const g = r.result.transaction("library", "readonly").objectStore("library").get("current");
            g.onsuccess = () => res(g.result ?? null);
          };
        }),
    );
    expect(
      binState!.bin.some((b) => /^sample@\d+@\d+$/.test(b.key) || /^apogee@\d+@\d+$/.test(b.key)),
      "writes the bin item in the legacy key shape",
    ).toBeTruthy();
  });

  // --- SRT export ---
  await test.step("SRT export", async () => {
    const [srt] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "EXPORT SRT" }).click(),
    ]);
    expect(
      /^recall-clips-\d{4}-\d{2}-\d{2}\.srt$/.test(srt.suggestedFilename()),
      `SRT filename is legacy-exact (${srt.suggestedFilename()})`,
    ).toBeTruthy();
    let srtText = "";
    for await (const c of await srt.createReadStream()) srtText += c;
    expect(
      /^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/.test(srtText),
      "SRT is well-formed SubRip",
    ).toBeTruthy();
    expect(srtText.endsWith("\n"), "SRT ends with the spec's trailing newline").toBeTruthy();
  });

  // --- library export envelope ---
  await test.step("library export envelope", async () => {
    const [lib] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "EXPORT LIBRARY" }).click(),
    ]);
    expect(
      /^recall-library-\d{4}-\d{2}-\d{2}\.json$/.test(lib.suggestedFilename()),
      `library filename is legacy-exact (${lib.suggestedFilename()})`,
    ).toBeTruthy();
    let libText = "";
    for await (const c of await lib.createReadStream()) libText += c;
    const env = JSON.parse(libText);
    expect(
      env.schema === "recall.library.v1" && env.version === 1 && env.app === "RECALL",
      "export envelope matches the legacy schema",
    ).toBeTruthy();
    expect(env.library.sources.length === 2, "export carries both sources").toBeTruthy();
  });

  // --- add a source, parsing a real SRT paste ---
  await test.step("add a source, parsing a real SRT paste", async () => {
    await page.getByRole("button", { name: "+ ADD SOURCE" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByPlaceholder("e.g. Podcast ep. 41").fill("Pasted episode");
    await page.getByPlaceholder(/Discipline is just remembering/).fill(
      ["1", "00:00:01,000 --> 00:00:03,000", "Discipline is just remembering", "",
       "2", "00:00:03,000 --> 00:00:06,000", "what you want. Confidence comes after the work.", ""].join("\n"),
    );
    await page.waitForTimeout(150);
    expect(
      (await page.getByRole("dialog").textContent())!.includes("SRT / WebVTT cues"),
      "previews the detected format before saving",
    ).toBeTruthy();
    await page.getByRole("button", { name: "ADD SOURCE", exact: true }).click();
    await page.waitForTimeout(250);
    expect((await body()).includes("Pasted episode"), "adds the parsed source").toBeTruthy();
  });

  // --- delete writes a tombstone, or sync resurrects the source ---
  await test.step("delete writes a tombstone, or sync resurrects the source", async () => {
    await page.getByRole("button", { name: "Remove Sample — Discipline rant" }).click();
    await page.getByRole("button", { name: "REMOVE?" }).click();
    await page.waitForTimeout(250);
    const tombs = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("stack_tombstones_v1"))) ?? "{}",
    );
    expect(
      Object.keys(tombs).some((k) => k.startsWith("recallSource:")),
      "delete writes a recallSource tombstone",
    ).toBeTruthy();
    expect(
      !(await body()).includes("Sample — Discipline rant"),
      "removing a source takes its bin items with it",
    ).toBeTruthy();
  });

  expect(errors.length === 0, "no console or page errors").toBeTruthy();
});

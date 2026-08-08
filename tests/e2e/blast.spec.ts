// Phase 5 verification: drive BLAST against a legacy-shaped queue and assert
// that blast_session_v1 — the projection PULSE reads — tracks every mutation.
import { test, expect, type Locator } from "@playwright/test";

// The original suite opened its context with clipboard permissions because the
// COPY check reads navigator.clipboard back. The `page` fixture replaces the
// hand-rolled context, so the grant moves here.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// A queue exactly as blast/app.js leaves it: Quick post plus one clip RECALL
// sent over, carrying its pattern provenance.
const QUEUE = {
  v: 1,
  updatedAt: 1754600000000,
  defaultPlatforms: null,
  batchCount: 1,
  clips: [
    {
      key: "quick",
      srcId: "", srcTitle: "", t: "", sec: 0,
      text: "Discipline is just remembering what you want.",
      hookText: "", label: "", platforms: ["X", "TikTok"],
      patternId: "", patternName: "", patternFamily: "",
      captions: {}, titles: {}, suggestions: {}, picked: {},
      status: {}, postUrl: {}, postedAt: {}, postedCaption: {},
      genState: "pending", genError: "", source: "quick",
      createdAt: 1754600000000, updatedAt: 1754600000000,
    },
    {
      key: "ep41@41@2",
      srcId: "ep41", srcTitle: "Episode 41", t: "0:00:41", sec: 41,
      text: "The hardest rep is the one nobody sees.",
      hookText: "The hardest rep is the one nobody sees.",
      label: "proof", platforms: null,
      patternId: "p_identity", patternName: "Identity claim", patternFamily: "identity",
      captions: {}, titles: {}, suggestions: {}, picked: {},
      status: {}, postUrl: {}, postedAt: {}, postedCaption: {},
      genState: "done", genError: "", source: "recall",
      createdAt: 1754600000000, updatedAt: 1754600000000,
    },
  ],
};

// One test, not many: every section below depends on the page state the
// previous section left behind.
test("BLAST keeps the blast_session_v1 projection in step with every mutation", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((q) => {
    localStorage.setItem("blast_queue_v1", JSON.stringify(q));
    localStorage.setItem("blast_batch_count_v1", "2");
  }, QUEUE);

  const session = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("blast_session_v1") ?? "null"));
  const queue = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("blast_queue_v1") ?? "null"));
  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  // Locators and reads that outlive the step that created them.
  let xCard: Locator;
  let q2: any;

  await page.goto("#/blast", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "BLAST" }).waitFor();

  await test.step("the projection is rebuilt on load, before anything is typed", async () => {
    const onLoad = await session();
    expect(onLoad !== null, "rebuilds the projection on load").toBeTruthy();
    expect(
      onLoad && Object.keys(onLoad).sort().join(",") ===
        ["base","captions","picked","postUrl","postedAt","postedCaption","status","suggestions","titles","transcript","updatedAt","videoHook"].join(","),
      `projection has exactly the 12 legacy fields — ${onLoad && Object.keys(onLoad).sort().join(",")}`,
    ).toBeTruthy();
    expect(onLoad?.base === QUEUE.clips[0]!.text, "projects the Quick post's caption").toBeTruthy();
  });

  await test.step("the queue renders, Quick first", async () => {
    expect((await body()).includes("Episode 41"), "renders both queued clips").toBeTruthy();
    expect((await body()).includes("Quick post"), "shows the Quick post first").toBeTruthy();

    // The Quick post limits itself to X and TikTok.
    expect(
      (await page.getByRole("button", { name: /MARK POSTED/ }).count()) === 2,
      "honors the clip's own platform selection",
    ).toBeTruthy();
  });

  await test.step("a base caption edit reaches the projection", async () => {
    await page.getByPlaceholder(/only wrote one/).fill("A brand new base caption");
    await page.waitForTimeout(250);
    expect(
      (await session())?.base === "A brand new base caption",
      "a base caption edit reaches the projection",
    ).toBeTruthy();
  });

  await test.step("a per-platform caption reaches the projection", async () => {
    xCard = page.locator("li").filter({ has: page.getByLabel("X caption") }).first();
    await page.getByLabel("X caption").fill("Tailored for X");
    await page.waitForTimeout(250);
    const afterCaption = await session();
    expect(
      afterCaption?.captions?.X === "Tailored for X",
      "a per-platform caption reaches the projection",
    ).toBeTruthy();
    expect(afterCaption?.captions?.TikTok === undefined, "other platforms are left alone").toBeTruthy();
  });

  await test.step("the character counter warns without blocking", async () => {
    await page.getByLabel("X caption").fill("y".repeat(300));
    await page.waitForTimeout(200);
    expect((await body()).includes("300/280"), "warns past the platform limit").toBeTruthy();
    expect((await body()).includes("20 OVER"), "says how far over").toBeTruthy();

    await page.getByLabel("X caption").fill("Tailored for X");
    await page.waitForTimeout(200);
  });

  await test.step("copy bumps status forward, and only forward", async () => {
    await xCard.getByRole("button", { name: "COPY", exact: true }).click();
    await page.waitForTimeout(300);
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())) === "Tailored for X",
      "copying records the caption on the clipboard",
    ).toBeTruthy();
    expect((await session())?.status?.X === "copied", "copying bumps status to copied").toBeTruthy();
  });

  await test.step("mark posted records url, caption and time", async () => {
    await xCard.getByRole("button", { name: "MARK POSTED" }).click();
    await page.getByLabel("X post URL").fill("https://x.com/me/status/123");
    await xCard.getByRole("button", { name: "CONFIRM" }).click();
    await page.waitForTimeout(300);
    const afterPosted = await session();
    expect(afterPosted?.status?.X === "posted", "marking posted reaches the projection").toBeTruthy();
    expect(
      afterPosted?.postUrl?.X === "https://x.com/me/status/123",
      "records the post URL for PULSE",
    ).toBeTruthy();
    expect(
      afterPosted?.postedCaption?.X === "Tailored for X",
      "records the caption as it actually went out",
    ).toBeTruthy();
    expect(typeof afterPosted?.postedAt?.X === "number", "stamps when it was posted").toBeTruthy();
  });

  await test.step("status never moves backward", async () => {
    await xCard.getByRole("button", { name: "COPY", exact: true }).click();
    await page.waitForTimeout(300);
    expect(
      (await session())?.status?.X === "posted",
      "copying after posting does not knock status back",
    ).toBeTruthy();
  });

  await test.step("updatedAt bumps, so a merge can tell this device is newer", async () => {
    const q1 = await queue();
    expect(
      q1.clips[0].updatedAt > QUEUE.clips[0]!.updatedAt,
      "the clip's updatedAt moved past the seeded value",
    ).toBeTruthy();
  });

  await test.step("presets apply without touching the stored caption", async () => {
    await page.getByRole("button", { name: "PRESETS" }).click();
    await page.getByLabel("X").first().waitFor();
    await page.locator("#preset-X").fill("{caption}\n\n#discipline");
    await page.waitForTimeout(300);
    const presets = await page.evaluate(() => JSON.parse(localStorage.getItem("blast_presets_v1") ?? "{}"));
    expect(presets.X === "{caption}\n\n#discipline", "presets persist under their own key").toBeTruthy();
    expect(
      (await session())?.captions?.X === "Tailored for X",
      "presets are separate from the queue",
    ).toBeTruthy();
    expect((await body()).includes("PRESET APPLIED"), "the card says a preset is applied").toBeTruthy();
  });

  await test.step("a non-Quick clip must NOT write the projection", async () => {
    const beforeOther = await session();
    await page.getByRole("button", { name: "Episode 41", exact: true }).click();
    await page.getByPlaceholder(/only wrote one/).fill("Editing the queued clip");
    await page.waitForTimeout(300);
    const afterOther = await session();
    expect(
      afterOther?.base === beforeOther?.base,
      "editing a queued clip leaves the Quick projection untouched",
    ).toBeTruthy();
    q2 = await queue();
    expect(
      q2.clips.find((c: any) => c.key === "ep41@41@2").text === "Editing the queued clip",
      "but the queued clip itself is saved",
    ).toBeTruthy();
    expect(
      q2.clips.find((c: any) => c.key === "ep41@41@2").patternFamily === "identity",
      "the queued clip keeps its pattern provenance",
    ).toBeTruthy();
  });

  await test.step("batch count is read from its own key, not the blob", async () => {
    expect(
      (await page.evaluate(() => localStorage.getItem("blast_batch_count_v1"))) === "2",
      "reads the batch count from its own key",
    ).toBeTruthy();
    expect(q2.batchCount === 2, "stamps the setting into the blob for sync").toBeTruthy();
  });

  await test.step("removing a queued clip; Quick is permanent", async () => {
    await page.getByRole("button", { name: /Remove Episode 41/ }).click();
    await page.waitForTimeout(300);
    const q3 = await queue();
    expect(!q3.clips.some((c: any) => c.key === "ep41@41@2"), "removes the queued clip").toBeTruthy();
    expect(q3.clips[0].key === "quick", "keeps the Quick post, always first").toBeTruthy();
  });

  await test.step("reset clears Quick only", async () => {
    await page.getByRole("button", { name: "RESET", exact: true }).click();
    await page.waitForTimeout(300);
    const afterReset = await session();
    expect(afterReset?.base === "", "reset clears the projection's caption").toBeTruthy();
    expect(JSON.stringify(afterReset?.captions) === "{}", "reset clears per-platform captions").toBeTruthy();
    expect(
      (await page.evaluate(() => JSON.parse(localStorage.getItem("blast_presets_v1") ?? "{}"))).X !== undefined,
      "presets survive reset",
    ).toBeTruthy();
  });

  expect(
    errors.length === 0,
    `no console or page errors — ${errors.slice(0, 3).join(" | ")}`,
  ).toBeTruthy();
});

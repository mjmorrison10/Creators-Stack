// The legacy-upgrade path, driven through the real browser.
//
// A creator mid-session in the still-deployed BLAST opens the unified app for
// the first time: blast_session_v1 exists, blast_queue_v1 does not. A code
// review found this destroyed the in-flight caption, and no test spanned it —
// the migration is a pure function, but whether its result is WRITTEN is a
// question about the mount sequence. That is what this drives.
import { test, expect } from "@playwright/test";

type QueueClip = {
  key: string;
  text?: string;
  hookText?: string;
  captions?: Record<string, string>;
  status?: Record<string, string>;
};
type BlastQueue = { clips?: QueueClip[] } | null;
type BlastSession = {
  base?: string;
  captions?: Record<string, string>;
  status?: Record<string, string>;
  transcript?: string;
} | null;

// Exactly what legacy BLAST leaves behind mid-session.
const SESSION = {
  base: "my in-flight caption",
  videoHook: "the opening line",
  transcript: "a transcript I pasted",
  captions: { X: "tailored for X", TikTok: "tailored for TikTok" },
  titles: {},
  suggestions: {},
  picked: {},
  status: { X: "copied" },
  postUrl: {},
  postedAt: {},
  postedCaption: {},
  updatedAt: 1754600000000,
};

// One test, not many: the rescue, the projection rebuilt from it, and the
// reload that proves it stuck are all the same continuous session.
test("BLAST rescues a legacy mid-session and drains the RECALL handoff", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.addInitScript((s) => {
    localStorage.setItem("blast_session_v1", JSON.stringify(s));
    // Deliberately NO blast_queue_v1 — that is what makes this the upgrade path.
    localStorage.removeItem("blast_queue_v1");
  }, SESSION);

  const ls = (k: string) => page.evaluate((key: string) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, k);

  await page.goto("#/blast", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "BLAST" }).waitFor();
  await page.waitForTimeout(400);

  // --- the rescue actually happened, and was written to disk ---
  await test.step("the rescue actually happened, and was written to disk", async () => {
    const queue: BlastQueue = await ls("blast_queue_v1");
    expect(queue !== null, "the migration is PERSISTED, not left in React state").toBeTruthy();
    const quick = queue?.clips?.find((c) => c.key === "quick");
    expect(quick?.text === "my in-flight caption", "the in-flight caption survived").toBeTruthy();
    expect(quick?.hookText === "the opening line", "the video hook survived").toBeTruthy();
    expect(
      JSON.stringify(quick?.captions) === JSON.stringify(SESSION.captions),
      "the per-platform captions survived",
    ).toBeTruthy();
    expect(quick?.status?.X === "copied", "the posting status survived").toBeTruthy();
  });

  // --- and the projection was rebuilt from the MIGRATED clip, not a blank one ---
  await test.step("the projection was rebuilt from the MIGRATED clip, not a blank one", async () => {
    const session: BlastSession = await ls("blast_session_v1");
    expect(session?.base === "my in-flight caption", "the projection still holds the caption").toBeTruthy();
    expect(
      session?.captions?.X === "tailored for X",
      "the projection still holds the per-platform captions",
    ).toBeTruthy();
    expect(session?.status?.X === "copied", "the projection still holds the status").toBeTruthy();
    expect(session?.transcript === "a transcript I pasted", "the transcript rode through").toBeTruthy();
  });

  // --- the UI shows it, so the creator sees their work ---
  await test.step("the UI shows it, so the creator sees their work", async () => {
    const shown = await page.getByPlaceholder(/only wrote one/).inputValue();
    expect(shown === "my in-flight caption", "the caption is on screen").toBeTruthy();
  });

  // --- and it survives a reload, which is the whole point ---
  await test.step("it survives a reload, which is the whole point", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "BLAST" }).waitFor();
    await page.waitForTimeout(300);
    expect(
      (await page.getByPlaceholder(/only wrote one/).inputValue()) === "my in-flight caption",
      "still there after a reload",
    ).toBeTruthy();
    const reloaded: BlastSession = await ls("blast_session_v1");
    expect(
      reloaded?.base === "my in-flight caption",
      "the projection is still intact after a reload",
    ).toBeTruthy();
  });

  // --- second scenario: the single-caption inbox legacy RECALL writes ---
  await test.step("second scenario: the single-caption inbox legacy RECALL writes", async () => {
    const page2 = await page.context().newPage();
    page2.on("pageerror", (e) => errors.push(String(e)));
    await page2.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("blast_handoff_v1", JSON.stringify({
        caption: "a caption sent from RECALL", source: "recall", createdAt: 1754600000000,
      }));
    });
    await page2.goto("#/blast", { waitUntil: "networkidle" });
    await page2.getByRole("heading", { name: "BLAST" }).waitFor();
    await page2.waitForTimeout(400);

    expect(
      (await page2.getByPlaceholder(/only wrote one/).inputValue()) === "a caption sent from RECALL",
      "a RECALL handoff lands in the Quick post",
    ).toBeTruthy();
    expect(
      (await page2.evaluate(() => localStorage.getItem("blast_handoff_v1"))) === null,
      "and the inbox is drained so it can't re-apply",
    ).toBeTruthy();
  });

  expect(errors.length === 0, "no console or page errors").toBeTruthy();
});

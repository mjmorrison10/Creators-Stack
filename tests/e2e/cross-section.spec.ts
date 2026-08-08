// Phase 7: the handoff links, the empty states, and the cross-tab guard.
//
// The echo-guard fix carries one real risk — over-suppressing a legitimate
// write from ANOTHER tab — so that is what this drives, with two real pages
// sharing one origin.
import { test, expect } from "@playwright/test";

const now = Date.now();

// One test, not one per section: the cross-tab step asserts against the post
// judged in the PULSE step, and the second page must share this page's origin.
test("cross-section handoffs, empty states and the cross-tab guard", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.addInitScript((n) => {
    localStorage.setItem("pulse_posts_v1", JSON.stringify([{
      id: "p_1", platform: "TikTok", url: "", caption: "", hook: "a tracked hook",
      postedAt: n - 5 * 3600000,
      snapshots: [{ at: n - 4 * 3600000, elapsedMin: 60, views: 1000, likes: null, comments: null, source: "manual" }],
      outcome: null, ledgerLoggedAt: null, clipKey: "k", clipId: "c1",
    }]));
  }, now);

  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  await test.step("HOOKLAB empty states", async () => {
    await page.goto("#/hooklab", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "HOOKLAB" }).waitFor();
    expect(
      (await body()).includes("NOTHING UNDERWRITTEN YET"),
      "HOOKLAB says what UNDERWRITE will do before you press it",
    ).toBeTruthy();
    expect((await body()).includes("no history yet"), "and explains the honesty rule up front").toBeTruthy();

    await page.getByRole("button", { name: "UNDERWRITE HOOKS" }).click();
    await page.waitForTimeout(400);
    expect(
      !(await body()).includes("NOTHING UNDERWRITTEN YET") && (await body()).includes("RANKED"),
      "the placeholder gives way to real results",
    ).toBeTruthy();
    expect(
      !(await body()).includes("arrives with the BLAST section"),
      "the stale 'AI drafting arrives with BLAST' hint is gone",
    ).toBeTruthy();
  });

  await test.step("PULSE handoff link", async () => {
    await page.goto("#/pulse", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "PULSE" }).waitFor();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^k/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Winner", exact: true }).first().click();
    await page.waitForTimeout(400);
    expect(
      (await page.getByRole("link", { name: /OPEN HOOKLAB/ }).count()) === 1,
      "judging a post offers a way to go read the ledger",
    ).toBeTruthy();
    await page.getByRole("link", { name: /OPEN HOOKLAB/ }).click();
    await page.waitForTimeout(400);
    expect(
      (await page.getByRole("heading", { name: "HOOKLAB" }).count()) === 1,
      "and the link actually navigates",
    ).toBeTruthy();
  });

  await test.step("cross-tab: the guard must NOT suppress another tab's write", async () => {
    const other = await context.newPage();
    await other.goto("#/settings", { waitUntil: "networkidle" });
    await page.goto("#/pulse", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "PULSE" }).waitFor();
    await page.waitForTimeout(300);

    // A second tab writes a brand-new post directly, then fires the storage event
    // the way a real cross-tab write does.
    await other.evaluate((n) => {
      const cur = JSON.parse(localStorage.getItem("pulse_posts_v1") ?? "[]");
      cur.push({
        id: "p_from_other_tab", platform: "X", url: "", caption: "",
        hook: "written by another tab", postedAt: n - 3600000, snapshots: [],
        outcome: null, ledgerLoggedAt: null, clipKey: "k2", clipId: "c2",
      });
      localStorage.setItem("pulse_posts_v1", JSON.stringify(cur));
    }, now);
    // jsdom aside: real browsers deliver `storage` to OTHER documents only, which
    // is exactly the path under test.
    await page.waitForTimeout(600);
    // The new clip renders as a COLLAPSED card labelled by its clipKey, so assert
    // on that and on the due count rather than on hook text that is not in the DOM.
    expect(
      (await page.getByRole("button", { name: /^k2/ }).count()) === 1,
      `a write from another tab still reaches this one — ${(await body()).slice(0, 140)}`,
    ).toBeTruthy();
    expect((await body()).includes("2 CHECK-INS DUE"), "and the section recounts what is due").toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors — ${errors.slice(0, 3).join(" | ")}`).toBeTruthy();
});

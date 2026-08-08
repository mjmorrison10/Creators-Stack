// Phase 6 part 4d: drive PULSE against legacy-shaped data in a real browser.
//
// The three things that can only be checked here: that the boot healers run
// BEFORE the first paint, that an outcome click reaches HOOKLAB's ledger, and
// that the sessionStorage view state survives a reload.
import { test, expect } from "@playwright/test";

const HOUR = 3600000;
const now = Date.now();
const snap = (elapsedMin: number, views: number, at: number) => ({
  at, elapsedMin, views, likes: null, comments: null, source: "manual",
});

// Legacy-shaped posts, deliberately containing BOTH kinds of damage the
// healers exist to repair: a clip split across two ids, and a twin pair.
const POSTS = [
  // Split clip: same clipKey, two clipIds. migrateClipIds must unify them.
  { id: "p_split_a", platform: "TikTok", url: "", caption: "", hook: "the split clip",
    postedAt: now - 100 * HOUR, snapshots: [snap(60, 900, now - 99 * HOUR)],
    outcome: null, ledgerLoggedAt: null, clipKey: "the split clip", clipId: "c_old" },
  { id: "p_split_b", platform: "X", url: "", caption: "", hook: "the split clip",
    postedAt: now - 90 * HOUR, snapshots: [], outcome: null, ledgerLoggedAt: null,
    clipKey: "the split clip", clipId: "c_new" },

  // Twin pair: same clipId AND platform. healImportTwins must merge them,
  // keeping the one with the link and the earliest postedAt.
  { id: "p_twin_keep", platform: "Instagram Reels", url: "https://instagram.com/reel/1",
    caption: "", hook: "the twinned clip", postedAt: now - 80 * HOUR,
    snapshots: [snap(60, 500, now - 79 * HOUR)], outcome: null, ledgerLoggedAt: null,
    clipKey: "twinned", clipId: "c_twin" },
  { id: "p_twin_drop", platform: "Instagram Reels", url: "", caption: "", hook: "",
    postedAt: now - 200 * HOUR, snapshots: [snap(360, 2500, now - 70 * HOUR)],
    outcome: null, ledgerLoggedAt: null, clipKey: "twinned", clipId: "c_twin" },

  // A clean, recent post with a real reading — the one we will judge.
  { id: "p_clean", platform: "YouTube Shorts", url: "https://youtube.com/shorts/abc123",
    caption: "", hook: "the hardest rep is the one nobody sees",
    postedAt: now - 5 * HOUR, snapshots: [snap(60, 42000, now - 4 * HOUR)],
    outcome: null, ledgerLoggedAt: null, clipKey: "clean", clipId: "c_clean",
    patternId: "p_identity", patternFamily: "identity" },
];

// One test, not one per section: every step below is asserted against the state
// the previous step left behind, right through the reload.
test("PULSE heals legacy data, tracks readings and promotes into HOOKLAB", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // Guarded: addInitScript re-runs on every navigation, so without this the
  // reload below would re-seed the damaged data and the healers would correctly
  // merge a second time — making the idempotence check meaningless.
  await page.addInitScript((posts) => {
    if (localStorage.getItem("__seeded")) return;
    localStorage.setItem("__seeded", "1");
    localStorage.setItem("pulse_posts_v1", JSON.stringify(posts));
    // The shared store is where Settings writes API keys. PULSE reading only its
    // own blob meant a key entered in Settings never reached this section.
    localStorage.setItem("stack_settings_v1", JSON.stringify({ ytKey: "AIzaTESTKEY0000000000000" }));
    localStorage.setItem("hooklab_state_v1", JSON.stringify({
      ledger: [{ id: "id_native", hook: "written in HOOKLAB", outcome: "winner" }],
      comps: [],
    }));
  }, POSTS);

  const ls = (k: string): Promise<any> => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, k);
  const posts = (): Promise<any[]> => ls("pulse_posts_v1");
  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  // `healed` is read again by the reload step, so it outlives the step that sets it.
  let healed: any[] = [];

  // Stubbed before the first navigation, because the section now checks what is
  // due as soon as it opens with a key present.
  await page.route("**/youtube/v3/videos**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ statistics: { viewCount: "77000" } }] }),
    }),
  );

  await page.goto("#/pulse", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "PULSE" }).waitFor();
  await page.waitForTimeout(400);

  await test.step("the healers ran, and ran before the paint", async () => {
    healed = await posts();
    expect(
      healed.find((p) => p.id === "p_split_a").clipId === healed.find((p) => p.id === "p_split_b").clipId,
      "the split clip was unified onto one id",
    ).toBeTruthy();
    expect(
      healed.find((p) => p.id === "p_split_b").clipId === "c_old",
      `the canonical id is the older one — ${healed.find((p) => p.id === "p_split_b").clipId}`,
    ).toBeTruthy();
    expect(
      healed.find((p) => p.id === "p_split_b").clipIdPrev === "c_new",
      "the rewrite is reversible",
    ).toBeTruthy();
    expect(!healed.some((p) => p.id === "p_twin_drop"), "the twin was merged away").toBeTruthy();
    expect(healed.some((p) => p.id === "p_twin_keep"), "the richer twin survived").toBeTruthy();
    const twin = healed.find((p) => p.id === "p_twin_keep");
    expect(twin.postedAt === now - 200 * HOUR, "the merged twin took the earliest postedAt").toBeTruthy();
    expect(
      twin.snapshots.length === 2,
      `the merged twin unioned both readings — ${String(twin.snapshots.length)}`,
    ).toBeTruthy();
    expect(
      JSON.stringify(await ls("stack_tombstones_v1") ?? {}).includes("p_twin_drop"),
      "the dropped twin was tombstoned",
    ).toBeTruthy();
    expect(
      (await page.locator("main").textContent())!.includes("Merged 1 duplicate import"),
      "the merge is reported to the creator",
    ).toBeTruthy();
  });

  await test.step("the first paint already shows healed data", async () => {
    expect(
      (await body()).match(/the split clip/g)!.length === 1,
      `the split clip renders as ONE card — ${String((await body()).match(/the split clip/g)?.length)}`,
    ).toBeTruthy();
  });

  await test.step("the shared YouTube key reaches PULSE (it did not, before)", async () => {
    expect(
      await page.getByRole("button", { name: "CHECK YOUTUBE" }).isEnabled(),
      "a key entered in Settings enables auto-tracking here",
    ).toBeTruthy();
    expect(
      (await ls("pulse_settings_v1"))?.ytKey === undefined,
      `with no PULSE-local key present at all — ${JSON.stringify(await ls("pulse_settings_v1"))}`,
    ).toBeTruthy();
  });

  await test.step("the section checks what is due as soon as it opens (it did not, before)", async () => {
    // p_clean is a Shorts post, 5h old, with one reading — so its 2h checkpoint is
    // owed and the boot pass should have fetched it without being asked.
    const booted = (await posts()).find((p) => p.id === "p_clean");
    expect(
      booted.snapshots.length === 2,
      `opening the section fetches what is due — ${String(booted.snapshots.length)}`,
    ).toBeTruthy();
    expect(
      booted.snapshots[booted.snapshots.length - 1].source === "auto",
      "and marks it as an automatic reading",
    ).toBeTruthy();
  });

  await test.step("clip view: grouping, due-first ordering, expand state", async () => {
    // The summary renders uppercased, and the card label is the clipKey — which
    // correctly outranks the hook, exactly as legacy `buildClipGroups` does.
    expect((await body()).includes("2 PLATFORMS"), "shows the clip view by default").toBeTruthy();
    expect((await body()).includes("CHECK-IN"), "surfaces what is due").toBeTruthy();

    const cleanCard = page.getByRole("button", { name: /^clean/ });
    await cleanCard.click();
    await page.waitForTimeout(200);
    expect((await body()).includes("77K VIEWS"), "expanding a clip reveals its post").toBeTruthy();
    expect(
      (await body()).includes("YOUTUBE SHORTS"),
      "shows the pattern-carrying post's platform",
    ).toBeTruthy();
    // Two readings an interval apart, so there is a rate to show. (Checked here
    // rather than after the manual record below: that one lands at the same elapsed
    // minute as the boot reading, and a zero interval correctly yields no rate.)
    expect(
      (await body()).includes("VIEWS/HR"),
      "views/hr appears once two readings are an interval apart",
    ).toBeTruthy();

    // expand state is sessionStorage, so it survives a reload
    expect(
      (await page.evaluate(() => sessionStorage.getItem("pulse_expanded_v1")))?.includes("c_clean"),
      "the open card is remembered",
    ).toBeTruthy();
  });

  await test.step("recording a reading", async () => {
    const input = page.locator("input[data-snap-input]").first();
    await input.fill("58000");
    await page.getByRole("button", { name: "RECORD" }).first().click();
    await page.waitForTimeout(300);
    const afterRecord = (await posts()).find((p) => p.id === "p_clean");
    expect(afterRecord.snapshots.length === 3, "a manual reading is recorded").toBeTruthy();
    expect(afterRecord.snapshots[2].source === "manual", "it is marked manual").toBeTruthy();
    expect(afterRecord.snapshots[2].likes === null, "likes stay null when nobody measured them").toBeTruthy();
  });

  await test.step("HIGH-2: a reading arriving from elsewhere resyncs the input", async () => {
    // Stub the YouTube API so CHECK NOW lands a new number, then assert the box
    // followed it. Before the fix the box kept the OLD value while the card showed
    // the new one, and pressing RECORD wrote the stale figure straight back — which
    // could drop a post below its promotion cutoff and retract its ledger row.
    await page.getByRole("button", { name: "CHECK NOW" }).first().click();
    await page.waitForTimeout(600);
    expect(
      (await posts()).find((p) => p.id === "p_clean").snapshots.length === 4,
      "an auto check records a reading",
    ).toBeTruthy();
    expect(
      (await page.locator("input[data-snap-input]").first().inputValue()) === "77000",
      `the input followed the fetched reading — ${await page.locator("input[data-snap-input]").first().inputValue()}`,
    ).toBeTruthy();

    // Pressing RECORD now must not resurrect the old number.
    await page.getByRole("button", { name: "RECORD" }).first().click();
    await page.waitForTimeout(300);
    const afterResync = (await posts()).find((p) => p.id === "p_clean");
    expect(
      afterResync.snapshots[afterResync.snapshots.length - 1].views === 77000,
      `recording after an auto check keeps the fetched figure — ${String(afterResync.snapshots[afterResync.snapshots.length - 1].views)}`,
    ).toBeTruthy();
  });

  await test.step("the outcome click reaches HOOKLAB", async () => {
    await page.getByRole("button", { name: "Winner", exact: true }).first().click();
    await page.waitForTimeout(400);
    const hl = await ls("hooklab_state_v1");
    const entry = hl.ledger.find((e: any) => e.id === "pulse_p_clean");
    expect(!!entry, "an outcome writes into the HOOKLAB ledger").toBeTruthy();
    expect(entry?.family === "identity", "the entry carries the pattern").toBeTruthy();
    expect(entry?.source === "pulse", "the entry names its source").toBeTruthy();
    expect(entry?.views === "77000", `the entry records the real view count — ${entry?.views}`).toBeTruthy();
    expect(
      hl.ledger.some((e: any) => e.id === "id_native" && e.hook === "written in HOOKLAB"),
      "the HOOKLAB-native entry is untouched",
    ).toBeTruthy();
    expect(
      (await posts()).find((p) => p.id === "p_clean").ledgerLoggedAt > 0,
      "the post is stamped as logged",
    ).toBeTruthy();
    expect((await body()).includes("IN HOOKLAB LEDGER"), "the card says it is in the ledger").toBeTruthy();

    // re-judging replaces rather than duplicating
    await page.getByRole("button", { name: "Dead", exact: true }).first().click();
    await page.waitForTimeout(400);
    const hl2 = await ls("hooklab_state_v1");
    expect(
      hl2.ledger.filter((e: any) => e.id === "pulse_p_clean").length === 1,
      "re-judging replaces the entry",
    ).toBeTruthy();
    expect(
      hl2.ledger.find((e: any) => e.id === "pulse_p_clean").outcome === "dead",
      "and records the new verdict",
    ).toBeTruthy();
  });

  await test.step("by-platform view", async () => {
    await page.getByRole("button", { name: "BY PLATFORMS" }).click();
    await page.waitForTimeout(300);
    expect(
      (await page.getByRole("button", { name: /^Instagram Reels/ }).count()) === 1,
      "the platform view lists platforms as chips",
    ).toBeTruthy();
    expect(
      (await page.getByRole("button", { name: "Winner", exact: true }).count()) === 0,
      "the thin rows carry no outcome buttons",
    ).toBeTruthy();
    await page.getByRole("button", { name: /^Instagram Reels/ }).click();
    await page.waitForTimeout(250);
    expect(
      (await page.evaluate(() => sessionStorage.getItem("pulse_platform_v1")))?.includes("Instagram"),
      "picking a platform is remembered",
    ).toBeTruthy();
    expect(
      (await ls("pulse_settings_v1"))?.view === "platforms",
      "the view preference persists to settings",
    ).toBeTruthy();
  });

  await test.step("reload: healed data stays healed, view state restored", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "PULSE" }).waitFor();
    await page.waitForTimeout(400);
    expect((await body()).includes("Instagram Reels"), "still on the platform view after a reload").toBeTruthy();
    expect(
      !(await body()).includes("Merged"),
      "no second merge on the second boot — the healers are idempotent",
    ).toBeTruthy();
    expect((await posts()).length === healed.length, "the posts survived the reload unchanged").toBeTruthy();
  });

  await test.step("manual add", async () => {
    await page.getByRole("button", { name: "BY CLIPS" }).click();
    await page.getByRole("button", { name: "ADD MANUALLY" }).click();
    await page.waitForTimeout(200);
    await page.getByLabel(/^Hook/).fill("a hand-added hook");
    await page.getByLabel(/^Link/).fill("https://www.tiktok.com/@me/video/99");
    await page.getByRole("button", { name: /^TRACK \d+ POST/ }).click();
    await page.waitForTimeout(400);
    const added = (await posts()).filter((p) => p.hook === "a hand-added hook");
    expect(added.length >= 1, "a manual add creates a post per picked platform").toBeTruthy();
    expect(
      added.find((p) => p.platform === "TikTok")?.url === "https://www.tiktok.com/@me/video/99",
      "the link attaches to the platform it points at",
    ).toBeTruthy();
    expect(
      added.filter((p) => p.platform !== "TikTok").every((p) => p.url === ""),
      "other platforms get no link",
    ).toBeTruthy();
    expect(
      added.every((p) => !p.clipId),
      "hand-added posts carry no clipId, so the healers ignore them",
    ).toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors — ${errors.slice(0, 3).join(" | ")}`).toBeTruthy();
});

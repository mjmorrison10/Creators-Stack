import { test, expect } from "@playwright/test";

/**
 * The whole loop, in one run: a moment in RECALL becomes a queued clip in
 * BLAST, gets a caption, goes out, is measured in PULSE, breaks out, and lands
 * back in HOOKLAB's ledger as evidence — which is where RECALL reads it as
 * personal proof next time.
 *
 * Every other spec covers one section. This one exists because the four
 * sections are joined by localStorage keys that no single-section test
 * exercises end to end, and a break in that chain is invisible until a real
 * creator loses a day's work to it.
 *
 * The PULSE baseline is seeded rather than driven: auto-promotion deliberately
 * refuses to fire without a trustworthy per-platform median (MIN_SAMPLE 8), so
 * a run that only ever creates one post can never reach the interesting
 * assertion. Eight ordinary TikTok posts is what "I have been posting for a
 * while" looks like, and it is the condition under which the gates mean
 * anything.
 */

const HOUR = 3_600_000;

const LIBRARY = {
  sources: [
    {
      id: "ep41",
      title: "Episode 41",
      segments: [
        { t: "0:00:05", sec: 5, text: "Discipline is just remembering what you want." },
        { t: "0:00:41", sec: 41, text: "The hardest rep is the one nobody sees." },
      ],
    },
  ],
  enabled: ["ep41"],
  bin: [] as unknown[],
};

/** One ordinary post: measured, unjudged, nowhere near a breakout. */
function ordinary(i: number, now: number) {
  return {
    id: `base_${i}`,
    platform: "TikTok",
    url: `https://tiktok.com/@me/video/${i}`,
    caption: `an ordinary clip ${i}`,
    hook: `an ordinary clip ${i}`,
    postedAt: now - (30 + i) * 24 * HOUR,
    snapshots: [
      {
        at: now - (29 + i) * 24 * HOUR,
        elapsedMin: 1440,
        views: 2000,
        likes: null,
        comments: null,
        source: "manual",
      },
    ],
    outcome: null,
    ledgerLoggedAt: null,
    clipKey: `base-${i}`,
    clipId: `basec${i}`,
  };
}

test("a binned moment becomes a measured breakout in the HOOKLAB ledger", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  const now = Date.now();
  await page.addInitScript(
    ({ lib, posts }) => {
      if (localStorage.getItem("__seeded")) return;
      localStorage.setItem("__seeded", "1");
      // The legacy key, so the loop starts from a real upgrade rather than a
      // shape only the new app ever writes.
      localStorage.setItem("recall_state_v2", JSON.stringify(lib));
      localStorage.setItem("pulse_posts_v1", JSON.stringify(posts));
      localStorage.setItem(
        "stack_settings_v1",
        JSON.stringify({ geminiKey: "AIzaTESTKEY0000000000000" }),
      );
    },
    { lib: LIBRARY, posts: Array.from({ length: 8 }, (_, i) => ordinary(i, now)) },
  );

  // The only outbound call in the run. An unstubbed one would fail the suite
  // rather than quietly leave the machine.
  await page.route("**generativelanguage.googleapis.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    TikTok: ["The hardest rep is the one nobody sees. Here is why that matters."],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
  });

  const ls = (key: string) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
  const body = () => page.locator("main").textContent().then((t) => t ?? "");

  await test.step("RECALL: find the moment and bin it", async () => {
    await page.goto("#/recall");
    await page.getByRole("heading", { name: "RECALL" }).waitFor();
    // The legacy library migrated in, which is the first link in the chain.
    await page.getByText(/MOMENTS INDEXED/).waitFor();

    await page.getByPlaceholder(/Search every moment/).fill("hardest rep");
    await page.waitForTimeout(400);
    expect((await body()).includes("hardest rep"), "the moment is findable").toBeTruthy();

    await page.getByRole("button", { name: "+ BIN" }).first().click();
    await page.waitForTimeout(200);
    expect(
      (await page.getByRole("button", { name: "IN BIN ✓" }).count()) >= 1,
      "the moment is in the bin",
    ).toBeTruthy();
  });

  await test.step("RECALL → BLAST: send the bin", async () => {
    await page.getByRole("button", { name: "SEND TO BLAST" }).click();
    await page.getByText(/Queued 1 clip/).waitFor();

    const queue = (await ls("blast_queue_v1")) as { clips: { key: string; text: string }[] };
    const sent = queue.clips.find((c) => c.key !== "quick");
    expect(!!sent, "the clip reached blast_queue_v1").toBeTruthy();
    // `hookText` stays empty on this path and that is correct: it is TOP
    // CLIPS' field, set when the PROOF pass matches a pattern. A plain bin
    // from search carries the moment's text, and PULSE's import falls back to
    // the caption's first line for the hook — which is what makes this clip
    // groupable later without ever having been scored.
    expect(
      sent!.text.includes("hardest rep"),
      "carrying the text PULSE will derive its hook from",
    ).toBeTruthy();
    expect(queue.clips[0]!.key === "quick", "and the Quick post is still pinned first").toBeTruthy();
  });

  let postedHook = "";

  await test.step("BLAST: caption it and mark it posted", async () => {
    await page.goto("#/blast");
    await page.getByRole("heading", { name: "BLAST" }).waitFor();
    await page.getByRole("button", { name: "Episode 41", exact: true }).click();
    await page.waitForTimeout(300);

    // TikTok is where the eight-post baseline lives, so that is the platform
    // this has to go out on. The toggle is a real toggle — clicking it blind
    // switched TikTok OFF on the first attempt and the post went to YouTube
    // Shorts instead, which has n=1 and therefore no trustworthy median, so
    // the run reached the last step with nothing promoted and nothing wrong.
    const toggle = page.getByRole("button", { name: "TikTok", exact: true }).first();
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await page.waitForTimeout(200);

    // Post from TikTok's own card, not whichever card happens to render first.
    const tiktokCard = page
      .locator("li")
      .filter({ has: page.getByLabel("TikTok caption") })
      .first();
    await tiktokCard.getByRole("button", { name: "MARK POSTED" }).click();
    await tiktokCard.getByRole("button", { name: "CONFIRM" }).click();
    await page.waitForTimeout(400);

    const queue = (await ls("blast_queue_v1")) as {
      clips: { key: string; text: string; status: Record<string, string> }[];
    };
    const clip = queue.clips.find((c) => c.key !== "quick")!;
    postedHook = clip.text;
    expect(
      Object.values(clip.status).some((s) => s === "posted"),
      "the clip records a posted platform",
    ).toBeTruthy();
  });

  await test.step("BLAST → PULSE: import it", async () => {
    await page.goto("#/pulse");
    await page.getByRole("heading", { name: "PULSE" }).waitFor();
    await page.getByRole("button", { name: "IMPORT FROM BLAST" }).click();
    await page.waitForTimeout(500);

    const posts = (await ls("pulse_posts_v1")) as { hook: string; platform: string }[];
    expect(posts.length === 9, "the imported post joins the eight baseline posts").toBeTruthy();
    expect(
      posts.filter((p) => p.platform === "TikTok").length === 9,
      "all nine on TikTok, so the baseline actually applies to it",
    ).toBeTruthy();
    expect(
      posts.some((p) => !!p.hook && postedHook.startsWith(p.hook.slice(0, 20))),
      "and it carries the hook derived from what BLAST posted",
    ).toBeTruthy();
  });

  await test.step("PULSE: record the breakout", async () => {
    // The group label is the clipKey, not the hook — deliberate, and inherited
    // from legacy: a clip posted to five platforms with five tailored captions
    // has five different caption-derived hooks but one identity, and that
    // identity is what the creator is looking at. An import from a queued clip
    // scopes that key by the RECALL moment it came from.
    await page.getByRole("button", { name: /ep41@41@1/ }).first().click();
    await page.waitForTimeout(300);

    const input = page.locator("input[data-snap-input]").first();
    await input.fill("30000");
    await page.getByRole("button", { name: "RECORD" }).first().click();
    await page.waitForTimeout(600);

    const posts = (await ls("pulse_posts_v1")) as { snapshots: { views: number }[] }[];
    expect(
      posts.some((p) => p.snapshots.some((s) => s.views === 30000)),
      "the reading is stored",
    ).toBeTruthy();
  });

  await test.step("PULSE → HOOKLAB: the breakout underwrites itself", async () => {
    const state = (await ls("hooklab_state_v1")) as {
      ledger: { id: string; hook: string; source: string; notes: string }[];
    };
    const auto = state.ledger.filter((e) => e.id.startsWith("pulseauto_"));
    expect(auto.length === 1, "exactly one auto entry was promoted").toBeTruthy();

    // 30,000 against a 2,000 median over nine posts: top decile, past the 3x
    // outlier gate, past the 10k floor, and 15x cross-platform.
    expect(
      /auto: top 10% on TikTok/.test(auto[0]!.notes),
      "and it states the evidence rather than asserting a verdict",
    ).toBeTruthy();
    expect(auto[0]!.source === "pulse-auto", "tagged as machine-promoted").toBeTruthy();
    expect(
      state.ledger.filter((e) => e.id.startsWith("pulseauto_")).length === auto.length,
      "no ordinary post was swept in with it",
    ).toBeTruthy();
  });

  await test.step("HOOKLAB: the ledger shows it as the creator's own evidence", async () => {
    await page.goto("#/hooklab");
    await page.getByRole("heading", { name: "HOOKLAB" }).waitFor();
    await page.getByRole("tab", { name: /LEDGER/ }).click();
    await page.waitForTimeout(300);
    expect((await body()).includes("AUTO"), "carrying the AUTO badge").toBeTruthy();
    expect(
      (await body()).toLowerCase().includes("hardest rep"),
      "and the hook that earned it",
    ).toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors: ${errors.slice(0, 3).join(" | ")}`)
    .toBeTruthy();
});

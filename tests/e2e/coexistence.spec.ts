import { test, expect } from "@playwright/test";

/**
 * The four legacy apps are still deployed at the same origin, and they are the
 * rollback plan. That only works if data the unified app writes stays readable
 * by the code they actually ship — so this spec seeds legacy-shaped state,
 * drives one real mutation per section, and then validates every touched key
 * against the shapes the OLD apps parse.
 *
 * The validators below are deliberately written from the legacy readers'
 * point of view: they check the fields those apps index into, and the types
 * they assume. A field the new app added is fine. A field it renamed, dropped,
 * or changed the type of is a broken rollback, and that is what fails here.
 *
 * Two conventions this spec exists to protect, because both are easy to
 * "tidy" into a bug: BLAST timestamps are ms-epoch NUMBERS while HOOKLAB's are
 * ISO STRINGS, and `blast-theme` is hyphenated where every other key uses
 * underscores.
 */

const HOUR = 3_600_000;

/** What a legacy app requires of the values it reads back. */
type Problem = string;

function checkBlastQueue(q: unknown): Problem[] {
  const bad: Problem[] = [];
  const queue = q as { clips?: unknown[]; updatedAt?: unknown };
  if (!queue || !Array.isArray(queue.clips)) return ["blast_queue_v1 has no clips array"];
  if (typeof queue.updatedAt !== "number") bad.push("queue.updatedAt is not a ms-epoch number");
  if ((queue.clips[0] as { key?: string })?.key !== "quick") {
    bad.push("the Quick clip is not first — legacy indexes it positionally");
  }
  for (const c of queue.clips as Record<string, unknown>[]) {
    if (typeof c.key !== "string" || !c.key) bad.push("a clip has no key");
    if (typeof c.text !== "string") bad.push(`clip ${String(c.key)}: text is not a string`);
    for (const dict of ["captions", "titles", "suggestions", "picked", "status"]) {
      if (typeof c[dict] !== "object" || c[dict] === null || Array.isArray(c[dict])) {
        bad.push(`clip ${String(c.key)}: ${dict} is not a plain object`);
      }
    }
    if (c.platforms !== null && !Array.isArray(c.platforms)) {
      bad.push(`clip ${String(c.key)}: platforms must be an array or null`);
    }
    if (typeof c.createdAt !== "number") bad.push(`clip ${String(c.key)}: createdAt is not ms-epoch`);
    for (const [name, s] of Object.entries((c.status ?? {}) as Record<string, string>)) {
      if (!["none", "copied", "opened", "posted", "skipped"].includes(s)) {
        bad.push(`clip ${String(c.key)}: unknown status "${s}" for ${name}`);
      }
    }
  }
  return bad;
}

/** The 12-field projection PULSE reads. Extra fields would confuse nothing; missing ones break it. */
function checkBlastSession(s: unknown): Problem[] {
  const bad: Problem[] = [];
  const sess = s as Record<string, unknown> | null;
  if (!sess) return ["blast_session_v1 is absent"];
  for (const f of [
    "base",
    "videoHook",
    "transcript",
    "captions",
    "titles",
    "suggestions",
    "picked",
    "status",
    "postUrl",
    "postedAt",
    "postedCaption",
    "updatedAt",
  ]) {
    if (!(f in sess)) bad.push(`session projection is missing "${f}"`);
  }
  if (typeof sess.updatedAt !== "number") bad.push("session.updatedAt is not ms-epoch");
  return bad;
}

function checkHooklab(state: unknown): Problem[] {
  const bad: Problem[] = [];
  const st = state as { ledger?: unknown; comps?: unknown };
  if (!st || !Array.isArray(st.ledger)) return ["hooklab_state_v1 has no ledger array"];
  if (!Array.isArray(st.comps)) bad.push("hooklab_state_v1 has no comps array");
  for (const e of st.ledger as Record<string, unknown>[]) {
    if (typeof e.id !== "string" || !e.id) bad.push("a ledger entry has no id");
    if (typeof e.hook !== "string" || !e.hook.trim()) {
      bad.push(`entry ${String(e.id)}: hook is empty — legacy drops these on import`);
    }
    // ISO strings, NOT ms-epoch: the merge engine's comparator for this key
    // parses dates, and a number here silently sorts as 1970.
    if (typeof e.createdAt !== "string" || Number.isNaN(Date.parse(e.createdAt))) {
      bad.push(`entry ${String(e.id)}: createdAt is not an ISO timestamp`);
    }
    if (e.outcome != null && !["winner", "meh", "dead"].includes(String(e.outcome))) {
      bad.push(`entry ${String(e.id)}: unknown outcome "${String(e.outcome)}"`);
    }
  }
  return bad;
}

function checkPulse(posts: unknown): Problem[] {
  const bad: Problem[] = [];
  if (!Array.isArray(posts)) return ["pulse_posts_v1 is not an array"];
  for (const p of posts as Record<string, unknown>[]) {
    if (typeof p.id !== "string" || !p.id) bad.push("a post has no id");
    if (typeof p.platform !== "string") bad.push(`post ${String(p.id)}: platform is not a string`);
    if (typeof p.postedAt !== "number") bad.push(`post ${String(p.id)}: postedAt is not ms-epoch`);
    if (!Array.isArray(p.snapshots)) {
      bad.push(`post ${String(p.id)}: snapshots is not an array`);
      continue;
    }
    for (const s of p.snapshots as Record<string, unknown>[]) {
      if (typeof s.elapsedMin !== "number") bad.push(`post ${String(p.id)}: snapshot elapsedMin`);
      if (typeof s.views !== "number") bad.push(`post ${String(p.id)}: snapshot views`);
      if (typeof s.at !== "number") bad.push(`post ${String(p.id)}: snapshot at`);
    }
    if (p.outcome != null && !["winner", "meh", "dead"].includes(String(p.outcome))) {
      bad.push(`post ${String(p.id)}: unknown outcome`);
    }
  }
  return bad;
}

test("data the unified app writes stays readable by the still-deployed legacy apps", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  const now = Date.now();

  await page.addInitScript(
    ({ n, hour }) => {
      if (localStorage.getItem("__seeded")) return;

      // Every seed below is written the way a LEGACY app would write it, not
      // the way the new app happens to.
      localStorage.setItem(
        "recall_state_v2",
        JSON.stringify({
          sources: [
            {
              id: "ep7",
              title: "Episode 7",
              segments: [
                { t: "0:00:12", sec: 12, text: "Nobody claps for the reps you skip." },
                { t: "0:01:30", sec: 90, text: "Consistency is a boring superpower." },
              ],
            },
          ],
          enabled: ["ep7"],
          bin: [],
        }),
      );

      localStorage.setItem(
        "blast_queue_v1",
        JSON.stringify({
          clips: [
            {
              key: "quick",
              srcId: "",
              srcTitle: "",
              t: "",
              sec: 0,
              text: "a quick base caption",
              hookText: "",
              label: "",
              platforms: null,
              patternId: "",
              patternName: "",
              patternFamily: "",
              captions: {},
              titles: {},
              suggestions: {},
              picked: {},
              status: {},
              postUrl: {},
              postedAt: {},
              postedCaption: {},
              genState: "pending",
              genError: "",
              source: "quick",
              createdAt: n - 10 * hour,
              updatedAt: n - 10 * hour,
            },
          ],
          updatedAt: n - 10 * hour,
          defaultPlatforms: null,
          batchCount: 1,
        }),
      );

      localStorage.setItem(
        "hooklab_state_v1",
        JSON.stringify({
          ledger: [
            {
              id: "id_legacy1",
              hook: "nobody claps for the reps you skip",
              patternId: "",
              family: "identity",
              outcome: "winner",
              platform: "tiktok",
              medium: "video",
              niche: "fitness",
              retention: "",
              views: "42000",
              notes: "",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
          comps: [],
        }),
      );

      localStorage.setItem(
        "pulse_posts_v1",
        JSON.stringify([
          {
            id: "leg_1",
            platform: "TikTok",
            url: "https://tiktok.com/@me/video/1",
            caption: "consistency is a boring superpower",
            hook: "consistency is a boring superpower",
            postedAt: n - 30 * hour,
            snapshots: [
              {
                at: n - 24 * hour,
                elapsedMin: 360,
                views: 4100,
                likes: null,
                comments: null,
                source: "manual",
              },
            ],
            outcome: null,
            ledgerLoggedAt: null,
            clipKey: "legacy-clip",
          },
        ]),
      );

      // The hyphen is not a typo — it is the real legacy key, and the one
      // place this stack breaks its own naming convention.
      localStorage.setItem("blast-theme", "dark");

      // The guard is set LAST on purpose. Set first, a throw anywhere above
      // leaves the guard standing over a half-written seed, and every later
      // navigation skips re-seeding — which is exactly how this spec first
      // reached PULSE with no posts and an error that pointed at the wrong
      // place entirely. Set last, a failed seed simply retries.
      localStorage.setItem("__seeded", "1");
    },
    // `hour` is passed in rather than closed over: addInitScript serializes
    // the function and evaluates it in the page, where a module-scope const
    // from the test file does not exist.
    { n: now, hour: HOUR },
  );

  const ls = (key: string) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
  const raw = (key: string) => page.evaluate((k) => localStorage.getItem(k), key);

  await test.step("RECALL: bin a moment", async () => {
    await page.goto("#/recall");
    await page.getByRole("heading", { name: "RECALL" }).waitFor();
    await page.locator("main").getByText(/MOMENTS INDEXED/).waitFor();
    await page.getByPlaceholder(/Search every moment/).fill("boring superpower");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "+ BIN" }).first().click();
    await page.waitForTimeout(300);
  });

  await test.step("BLAST: edit the Quick caption", async () => {
    await page.goto("#/blast");
    await page.getByRole("heading", { name: "BLAST" }).waitFor();
    const base = page.getByPlaceholder(/only wrote one/);
    await base.fill("an edited base caption");
    await page.waitForTimeout(400);
  });

  await test.step("HOOKLAB: log an outcome", async () => {
    await page.goto("#/hooklab");
    await page.getByRole("heading", { name: "HOOKLAB" }).waitFor();
    await page.getByRole("tab", { name: /LEDGER/ }).click();
    await page.waitForTimeout(300);
    await page.locator("main").getByText("LOG AN OUTCOME").waitFor();
    await page.getByPlaceholder("The opening line you used").fill("a hook logged by the unified app");
    await page.getByRole("button", { name: "LOG ENTRY" }).click();
    await page.locator("main").getByText("Logged.").waitFor();
  });

  await test.step("PULSE: record a reading", async () => {
    await page.goto("#/pulse");
    await page.getByRole("heading", { name: "PULSE" }).waitFor();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /legacy-clip/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator("input[data-snap-input]").first().fill("9100");
    await page.getByRole("button", { name: "RECORD" }).first().click();
    await page.waitForTimeout(500);
  });

  await test.step("every touched key still validates against the legacy shapes", async () => {
    // Every validator returns "no problems" for an empty collection, so first
    // prove there is something to validate. Without this the whole spec would
    // pass green against an app that silently wrote nothing at all — which is
    // the failure it is least allowed to miss.
    const queue = (await ls("blast_queue_v1")) as { clips: unknown[] };
    const hooklab = (await ls("hooklab_state_v1")) as { ledger: { hook: string }[] };
    const posts = (await ls("pulse_posts_v1")) as { snapshots: unknown[] }[];
    expect(queue?.clips?.length >= 1, "the mutations landed: a queue clip exists").toBeTruthy();
    expect(
      hooklab?.ledger?.some((e) => e.hook === "a hook logged by the unified app"),
      "the mutations landed: the logged entry is there",
    ).toBeTruthy();
    expect(
      posts?.some((p) => p.snapshots.length >= 2),
      "the mutations landed: the recorded reading is there",
    ).toBeTruthy();

    const problems = [
      ...checkBlastQueue(await ls("blast_queue_v1")),
      ...checkBlastSession(await ls("blast_session_v1")),
      ...checkHooklab(await ls("hooklab_state_v1")),
      ...checkPulse(await ls("pulse_posts_v1")),
    ];
    expect(problems.length === 0, `legacy-shape violations: ${problems.join("; ")}`).toBeTruthy();
  });

  await test.step("the legacy theme keys are read but never written", async () => {
    // Those apps are still deployed and still read these. Stamping the unified
    // preference into them would change what they show.
    expect((await raw("blast-theme")) === "dark", "blast-theme is untouched").toBeTruthy();
    expect((await raw("hooklab_theme")) === null, "hooklab_theme was not created").toBeTruthy();
    expect((await raw("pulse-theme")) === null, "pulse-theme was not created").toBeTruthy();
  });

  await test.step("the RECALL library lives in IndexedDB, where legacy reads it", async () => {
    const lib = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("recall", 1);
          req.onsuccess = () => {
            const db = req.result;
            const get = db.transaction("library", "readonly").objectStore("library").get("current");
            get.onsuccess = () => resolve(get.result ?? null);
            get.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        }),
    );
    const state = lib as { sources?: unknown[]; bin?: unknown[]; enabled?: unknown[] } | null;
    expect(!!state, "the library is in db `recall`, store `library`, key `current`").toBeTruthy();
    expect(Array.isArray(state!.sources), "with a sources array").toBeTruthy();
    expect(Array.isArray(state!.enabled), "an enabled array").toBeTruthy();
    expect((state!.bin as unknown[]).length === 1, "and the moment just binned").toBeTruthy();
  });

  expect(errors.length === 0, `no console or page errors: ${errors.slice(0, 3).join(" | ")}`)
    .toBeTruthy();
});

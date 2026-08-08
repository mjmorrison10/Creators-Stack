---
approved: 2026-08-06
---

# Unified app: merge RECALL + BLAST + HOOKLAB + PULSE into Creators-Stack

## Goal

Replace four separate vanilla-JS static sites with **one modern React SPA** at
`https://mjmorrison10.github.io/Creators-Stack/`, feature-complete against all
four, while keeping the data **byte-compatible**: same localStorage keys, same
schemas, same export envelopes, same Google Drive sync format.

Locked-in decisions:

- **Stack:** React + Vite + Tailwind + TypeScript, SPA, static build.
- **Data compatibility: EXACT.** Existing exports and Drive files just work.
- **Hosting:** GitHub Pages from this repo.
- **Scope:** all four apps' features before first ship.
- **PWA:** installable, offline app shell.
- **Old apps stay deployed** during transition — they are the rollback.

## Key architectural facts (verified in source)

- All four apps share ONE origin (`mjmorrison10.github.io`), so they share one
  localStorage and one IndexedDB. This app deploys to the same origin, so
  **existing browser data is readable in place — no import step on this device.**
- `stackdata.js` (844 lines, byte-identical across all four repos) is already
  the unified data layer: shared API keys, `mjm-stack-backup` v2 envelope,
  Drive sync (GIS token flow, `drive.file` scope), and an idempotent per-entity
  merge engine with tombstones and a workspace guard. It is **ported, never
  reinvented**.
- Cross-app integration is same-origin localStorage handoff. Those become
  in-app flows that still write the identical keys.

## Data-compatibility contract (definition of done)

- [ ] Every legacy key read/written with its **exact** name and schema —
      including `blast-theme`'s hyphen, HOOKLAB's ISO timestamps vs BLAST's
      ms-epoch numbers, and `pulse_expanded_v1` / `pulse_platform_v1` living in
      **session**Storage.
- [ ] RECALL library stays in IndexedDB (db `recall` v1, store `library`, key
      `"current"`); the `recall_state_v2` migration path is preserved.
- [ ] `blast_queue_v1` remains the source of truth, and the 12-field
      `blast_session_v1` projection is still written on every Quick-clip
      mutation (public contract PULSE reads; stays SYNC_EXCLUDEd).
- [ ] `hooklab_state_v1` id conventions preserved (`id_*`, `pulse_<id>`,
      `pulseauto_<id>`); AI hooks with an unresolvable patternId are dropped,
      never reattached; insights only at n ≥ 3, with n always shown.
- [ ] Every delete writes a tombstone (`recallSource`, `pulsePost`,
      `hooklabLedger`, `hooklabComp`, `blastClip`) or sync resurrects it.
- [ ] All four import envelopes accepted unchanged — plus the known PULSE bug
      fixed: link-less posts are no longer dropped on import.
- [ ] Export envelope shapes and filenames unchanged.
- [ ] Drive sync byte-compatible; a sync file written by an old app round-trips
      through this app without corrupting either.
- [ ] Merge idempotence preserved: `merge(merge(a,b),b) === merge(a,b)`.
- [ ] Every new key matches `/^(recall|hooklab|blast|pulse|stack)[-_]/i`
      (enforced by a unit test over the key registry).
- [ ] Old apps keep working against data this app wrote (coexistence E2E).

## Phases

0. **Scaffold + design system** — Vite/React/TS/Tailwind, base path, hash
   router, section shells, ported design tokens, agents, vendored assets.
1. **Data layer + merge engine + tests** — key registry, schemas, storage, IDB,
   `stackdata/` port with golden fixtures captured from the original JS.
2. **Shared services** — unified LLM provider, model picker, YouTube, ffmpeg,
   Settings + backup/import + Drive sync UI.
3. **HOOKLAB** — patterns, underwriting math, GENERATE / LEDGER / BANK.
4. **RECALL** — parsers, library, search, bin, exports, AI transcription,
   TOP CLIPS.
5. **BLAST** — queue, per-platform captions, presets, status machine, intents,
   AI suggestions, 9:16 reformat, session projection writer.
6. **PULSE** — import, views, YouTube stats, outcomes, auto-promotion, healers.
7. **Cross-section flows + polish.**
8. **Accessibility + PWA.**
9. **Committed E2E suite.**
10. **Deploy + live verification.**

## Rollback

- Pre-merge: revert the phase commit(s); the branch is not merged until Phase 10.
- Post-deploy: the four old apps are still live and untouched — they are the
  rollback. Reverting is "stop using the new URL".
- No destructive data migration happens at deploy time; the only migrations
  (`recall_state_v2`, PULSE healers) are the ones the old apps already run.

## Verification

1. Vitest green in CI from Phase 1 on (merge idempotence, golden-fixture
   identity against the original `stackdata.js`, schema validators, scoring
   pins, parser samples, key-regex test).
2. Playwright green headlessly, AI stubbed by network interception, including
   the coexistence test and base-path serving.
3. Post-deploy: poll the live URL with a cache-buster; confirm existing data
   appears in the new app and the old apps still work.
4. Fable audit: every phase and every contract checkbox verified PASS/FAIL.

## Execution log

- **Phase 0 — scaffold.** Vite 7 + React 19 + Tailwind 4 + TS scaffold on
  `base: "/Creators-Stack/"`; hash router with five routes; design tokens
  ported from the legacy `style.css` (same palette, same runtime
  `data-theme` switching); section shells; nine agency agents copied to
  `.claude/agents/`; `vendor/ffmpeg` (31 MB, verbatim from BLAST),
  `arena-ranking.json`, icons, and `refresh-leaderboard.mjs` vendored into
  `public/` and `scripts/`. Build verified: base path correct in `dist`.
  - Dependency note: `react-router-dom` is held at **latest (7.18.2)**, which
    carries one advisory (RSC-mode CSRF, GHSA-qwww-vcr4-c8h2). That code path
    needs a server and RSC; this is a static hash-routed SPA, so it is not
    reachable. Downgrading below 7.12 was tried and **reverted** — versions
    6.0.0–7.17.0 carry 14 advisories including XSS, open redirect, and RCE,
    so the older range is strictly worse. Revisit when a fixed 7.x or 8.x ships.
  - Verified headlessly on a preview server at the real base path: 14 checks
    covering routing, deep links, unknown-route fallback, asset resolution,
    and the theme tokens in both colour schemes plus the `data-theme`
    override. Two failures found and fixed during this: a missing favicon
    (console 404) and, in the check script itself, a navigation race and an
    assertion that wrongly assumed a dark runner.
  - Commit `748caaf`.

- **Phase 1, part 1 — data-layer foundation.** Commit `72a9825`.
  - `src/data/schemas/` transcribes the exact legacy shapes for all four apps
    plus the stack backup envelope, preserving the quirks that matter (BLAST
    ms-epoch vs HOOKLAB ISO timestamps, `blast-theme`'s hyphen, PULSE view
    state in sessionStorage, reserved `pulse_`/`pulseauto_` ledger ids).
  - `src/data/keys.ts` pins every persisted name in one place.
  - `src/data/storage.ts` — storage-as-source-of-truth boundary with
    cross-tab `storage` events and explicit quota errors.
  - `src/data/idb.ts` — RECALL library in IndexedDB at the legacy coordinates.
  - `src/data/stackdata/constants.ts` — exclusion lists ported verbatim with
    their rationale comments.
  - 13 unit tests green, including the contract tests that a key rename or a
    mis-scoped exclusion list would fail.
  - Cross-version note recorded in `constants.ts`: the new `stack_theme_v1`
    is SYNC_EXCLUDEd here, but the still-deployed apps predate the key and
    their `isStackKey` matches it, so a sync run **from an old app** will
    carry it into the Drive payload. Verified against the legacy source. Only
    a theme string is involved; it stops when the old apps are retired.

- **Phase 1b — merge engine.** Commit `2045eb9`.
  - Ported `workspace.ts`, `tombstones.ts`, `merge.ts`, `backup.ts` from
    `stackdata.js` lines 117–500. `drive.ts` deferred to Phase 2 with the
    other network services.
  - **Verified by differential testing, not review.** `tests/unit/legacy-harness.ts`
    loads the original `stackdata.js` into jsdom; `merge-golden.test.ts` runs
    both engines over the same inputs and requires identical JSON. 12 tests
    covering RECALL union (more-segments-wins), PULSE snapshot merge +
    duplicate collapse, HOOKLAB ledger precedence, BLAST per-clip union,
    tombstone suppression in both its forms, presets, unknown forward-compatible
    keys, the no-API-keys guarantee, and the workspace hard-block. Plus direct
    idempotence and fixed-point assertions.
  - **Mutation-tested the tests.** Deliberately flipped a sort comparator in
    the port and confirmed the parity suite failed (2 of 12 — exactly the
    fixtures with enough entries for order to matter), then reverted. A
    differential test that cannot fail is worthless; this one can.
  - Fixed the Phase 1a defect: `Workspace.createdAt` is a **number**.
  - Second intentional deviation: `ensureWorkspace(name)` takes the name as an
    argument rather than calling `window.prompt` mid-sync. Same id shape, same
    `"My workspace"` default; the UI asks properly in Phase 2.
  - `@types/node` added for the harness only (`types: ["vitest/globals","node"]`);
    no `src/` code imports node APIs. `*.tsbuildinfo` gitignored.
  - 25 tests green, typecheck clean, build clean.

- **Phase 2, part 1 — shared keys + LLM foundation.** Commit `1d190fc`.
  - `data/stackdata/shared.ts` (shared-store-wins reads, legacy promotion,
    explicit clear), `services/llm/timeouts.ts`, `services/llm/openrouter.ts`.
  - The three `llm.js` copies turned out to differ only in wrapper style,
    comment wording and the `X-Title` value — no semantic drift — so this is a
    port of blast's ES-module copy with `X-Title: "THE STACK"`.
  - **Porting defect caught by its own test:** the first draft dropped the rule
    that non-empty monologue with no JSON in it, when truncated or still
    mid-thought, is a *burned thinking budget* rather than a truncated answer.
    The wrong error tells the user to shorten their input, which does not help;
    the fix is a different model. Restored, along with the original truncation
    wording.
  - 18 new tests (43 total), including a stalling-body stub proving the
    deadline aborts a hung read rather than only a hung header, and an ASCII
    check on `X-Title` (a non-ISO-8859-1 header value throws at fetch time).
    A retry test that really slept 4s now uses a server RetryInfo of 0s —
    same path exercised, 72ms instead of 4s.

- **Phase 2, parts 2–5 — services + Settings. COMPLETE.** Commits `b1ee13e`,
  `975f0c3`, `d7cc16d`, `db29110`.
  - `llm/gemini.ts` + `llm/provider.ts`: one facade over both providers.
    `withGeminiFallback` moved out of blast/app.js so every section inherits
    it, with its trigger kept narrow — a rejected key fails identically on the
    other provider, so retrying would only spend quota to show the same error.
  - `models.ts`, `youtube.ts`, `ffmpeg.ts` (lazy; 31MB core never on the
    critical path), `stackdata/drive.ts`.
  - `data/hooks.ts`, `components/ui.tsx`, `features/settings/`.
  - **Third schema drift caught:** `SyncMeta.lastSyncAt` is a ms-epoch number,
    not an ISO string. The still-deployed apps read that key on this origin to
    decide whether to force the Google consent prompt.
  - **Bundle 289kB → 318kB** — the engine now actually ships; everything before
    this was tree-shaken out.
  - 90 unit tests green, plus 16 headless checks against data shaped exactly as
    the legacy apps leave it: adopts the old theme, reads existing keys, and
    downloads a backup whose envelope, filename and contents match the legacy
    format (ledger + posts + queue carried, API keys kept as a local backup
    should, device sync bookkeeping omitted).

- **Phase 3 — HOOKLAB. COMPLETE.** Commits `79b50e0`, `3fabd71`, `8a70f41`,
  `9c2da1a`, plus this review-fix commit.
  - `patterns.js` turned out to be a real ES module, so the port is proven by
    importing the original and deep-equalling it entry by entry rather than
    reviewed by eye. Mutation-checked: one strength flip produced two failures.
  - `underwrite.ts` and `ledger.ts` are line-by-line ports with their rules
    pinned as tests — personal evidence outweighs market strength, "proven"
    requires the user's own ledger, fatigue overrides proven, no-history is
    never rendered as 0%, insights need n≥3 and always show n.
  - **One recorded deviation:** comp import requires a non-whitespace hook
    where legacy accepted any truthy value. Stricter, and consistent with the
    ledger filter.
  - **Code review at phase close (`a54a946..9c2da1a`) found 10 defects, all in
    the new React code — every domain port held.** The differential-test
    strategy is doing what it was adopted for. All 10 fixed here: one-shot
    prefill, explicit status tone instead of string-sniffing, literal `$`
    handling and the `spoken` slot in offline fill, the TEXT-NATIVE chip
    re-keyed to medium (no pattern ever carried that tier), `poolLimit`
    honored in the core pass and `0` no longer falling through to 20, the
    duplicate "General" niche option, clipboard-rejection handling, a shared
    download helper, and `useHooklab` reading the freshest stored value so two
    writes in the same tick can't lose one.
  - **Regression the fixes introduced and caught before commit:** clearing the
    prefill flipped a `key` that remounted the ledger form, wiping the seeded
    hook. Found by the browser check, not by unit tests — the form state only
    exists in the DOM. The key was unnecessary and is gone.
  - 158 unit tests green, 24 HOOKLAB headless checks green, 6 browser checks
    covering the fixes that have no unit-testable surface. Bundle 318→390kB.

- **Phase 4 — RECALL. COMPLETE.** Commits `8117ecc`, `15f66d4`, `173a64b`,
  `717a5d5`, plus the transcription commit.
  - **Parser** (`domain/recall/parse.ts`): near-verbatim port. It lives inside
    app.js's IIFE so it can't be imported like patterns.js could, but it is
    pure — so the tests slice the original block out by marker and evaluate it,
    keeping the same differential guarantee. All three input formats covered
    plus the awkward real-transcript cases.
  - **Library ops** (`library.ts`): search, bin, source management, SRT and
    shot-list export, import envelopes. The legacy mutates a shared `state`;
    these return new objects. The three functions that decide things a user
    only notices after the damage — clip ranges and import behavior — are
    diffed against the originals, given a `state` to close over.
  - **TOP CLIPS** (`topclips.ts`, `scans.ts`): the evidence ladder and the
    saved-scan store. The 2,567-line vendored pattern snapshot is gone — the
    unified app imports the live bank, which is the path the shared origin
    already took.
  - **Transcription** (`transcribe.ts`): the file-kind gate, which is the
    load-bearing part. A `.txt` sent as fake audio once burned quota and died
    on MAX_TOKENS; `accept` is only a picker hint, so the check lives at the
    one chokepoint both the picker and drag-and-drop pass through.
  - **`recall_state_v2` migration** in `loadLibrary`, removing the localStorage
    copy only after the IndexedDB write succeeds.
  - **Fourth schema drift caught**, this time by typecheck:
    `TopClipCandidate.match` was typed as a string but the legacy persists an
    object into `recall_topclips_v1`. Now a discriminated union.
  - **Deviations recorded, not silent:** no demo transcripts seeded for a
    first-time user (an honest empty state instead, and ~48kB less bundle);
    blank pattern provenance omitted from a bin item rather than stored as an
    empty field.
  - **Two dead branches documented rather than removed**, so the port stays
    faithful: a segment can exceed the 40-word cap only as one unbroken
    sentence, and the "3-word skeletons must match completely" rule has no
    reachable case (scaffolds under three words are filtered out, and at
    exactly three every possible containment falls the same side of 0.75 as
    of 1.0).
  - 276 unit tests. Mutation-checked at every part; three mutations initially
    survived and each one exposed a real gap in the suite rather than being
    waved through — the ledger-similarity threshold in particular, where the
    only test used an exact match, so a 0.524 boundary case was added. That
    number is where the "never a fake proof" promise actually lives.
  - 59 headless checks across three suites: RECALL (migration, search, bin,
    exports, tombstones), TOP CLIPS (evidence ladder, saved scans, cleanup on
    delete), and transcription (AI stubbed by network interception per
    doctrine — text read locally, non-media refused, media parsed and saved).
  - Bundle 390 → 431kB.

- **Phase 4 code review** found 3 blockers, 5 findings and 6 nits. All fixed:
  - **A failed IndexedDB read hung the section forever.** `readLibrary` only
    guarded `openDb`, so a rejected `get` propagated past an uncaught `.then`
    and `loading` never cleared — Safari eviction or a corrupt store meant a
    permanent "Opening your library…". The legacy catches and falls through.
  - **Library writes could fail silently.** Every caller discarded the save
    promise, so a quota failure left the UI showing work that never reached
    disk. Now one `persist` reports once, the legacy localStorage fallback is
    restored, and the section renders the failure.
  - **A quota error during a scan wedged every SCAN button** for the session.
    Guarded, with the flag cleared in `finally`.
  - **Bin items from TOP CLIPS lost `patternFamily`** — the exact regression
    the legacy code documents ("which is why early auto entries all landed in
    family 'unknown'"). `buildBank` already indexed by id and nothing read it.
    Also restored the legacy `label` vocabulary rather than inventing a value
    in a field that crosses into `blast_queue_v1`.
  - **The ledger was read once at mount**, so a hook marked Winner seconds
    earlier didn't count. Harmless across two separate apps; a real bug when
    they are two tabs of one.
  - **`displaySet` showed unlabeled candidates** the legacy filtered out,
    which also made the honest "nothing scored high enough" empty state
    unreachable. Now labeled-only with the scout backfill.
  - CLEAR now confirms; the shot list is back to the legacy text and
    clipboard delivery; the delete tombstone is written after the save that
    can fail, not before.

- **Phase 5 — BLAST. Parts 1–6 done** (`ab1a4a9`, `3a2e5fd`, `87b6fe1`,
  `43115fc`, `79547e5`, `510ce46`).
  - Platform table, caption rules and the forward-only status machine; queue
    over `blast_queue_v1` with the `blast_session_v1` projection; presets and
    compose targets; caption editor and posting flow; AI suggestions grounded
    in the HOOKLAB ledger; RECALL → BLAST handoff.
  - **A Fable audit caught `queue.ts` shipping untested.** It was swept into
    the Phase 4 review-fix commit by `git add -A` and pushed under a message
    about RECALL, with zero tests — and it is the projection writer the plan
    names as a top risk. Nothing called it yet, so nothing was broken. Closed
    by part 2, along with two divergences the same audit found: batchCount was
    read from inside the queue blob rather than its own key (a synced queue
    would have silently changed this device's setting), and `saveQueue` had no
    quota shedding, so a full store lost the write outright.
  - **Single-writer property holds:** only `queue.ts` touches
    `blast_session_v1`, and every UI mutation funnels through one `commit` in
    `useBlast`. Verified by grep and by headless checks asserting the
    projection after each action — including that editing a QUEUED clip leaves
    the Quick projection untouched.
  - **Legacy comment/code mismatch recorded, not resolved:** the quota
    shedder's comment says "oldest clips first" while its loop sheds the newest
    first. Behavior ported; only our comment is corrected.
  - **Two pairs of mutually-redundant guards found by mutation testing** — the
    status machine's `>` plus its terminal-name check, and the session
    migration's queue-exists plus untouched checks. Each is individually
    removable with no test failing; removing both in either pair breaks a real
    contract. Both pairs kept, documented, and now covered by tests that
    exercise each guard as the deciding factor.
  - 416 unit tests. Headless: 33 BLAST UI checks, 14 AI checks with the
    provider stubbed by interception, 11 handoff checks. Bundle 433 → 460kB.

- **Phase 5 part 7 — 9:16 crop (`5bd8b5a`): DONE.** Fixed two divergences the
  audit found in the Phase 2 loader, which had no callers so had never run:
  the missing `-c:v libx264 -preset ultrafast -crf 23` (ffmpeg's own defaults
  are far slower, and this is wasm in a browser tab), and a hardcoded
  `in.mp4` where legacy passes the source's real extension. `+faststart`
  stays as the one deliberate addition. The panel is behind a toggle and
  unmounts to release the ~31MB core. The argument vector is diffed against
  the literal `exec()` call in blast/app.js; `cropWith` takes the engine so
  the write/exec/read sequence runs without wasm. Four mutations each fail a
  distinct test. 16 headless checks confirm nothing is fetched until asked.

- **Phase 5 part 8 — code review (`ddf08da`): 2 CRITICAL, 3 HIGH, 6 MEDIUM,
  5 LOW. All fixed.** Every finding was in the WIRING layer — the seam the
  427 domain tests did not span. Worth recording as a lesson: differential
  tests proved the pure functions correct and said nothing about whether
  their results were ever written.
  - **CRITICAL 1 — the legacy upgrade destroyed the in-flight session.** The
    migration produced a rescued Quick post in React state only, and the
    mount effect rebuilt the projection from a SECOND `loadQueue()`, which at
    that moment still found no queue — so a blank Quick post overwrote
    `blast_session_v1`, the only remaining copy. Legacy does `savePosts()`
    then projects from the in-memory clip; now so does this.
  - **CRITICAL 2 — `writeSessionProjection` threw during render.** Legacy
    calls a quota failure here non-fatal and catches it. The port let it
    escape from inside a state updater, so with no error boundary the whole
    app went white at the moment the shedding machinery was supposed to
    degrade gracefully.
  - Both are pinned by a headless suite that drives the real upgrade
    scenario in a browser. Verified against the previous bundle: 11 of its 15
    checks fail there, so the test genuinely spans the seam.
  - **Schema drift caught:** Pinterest suggestions were being flattened to
    strings, which would have left the still-deployed app's Pin-title field
    permanently empty. They stay `{title, description}` objects.
  - **Dead field revived:** `picked` was never written, so every generated
    option but the first was discarded. The chips exist now; picking one
    writes the caption, typing your own clears the pick.
  - Also: stale posting marks carried into a new clip (ported
    `startFreshPostingSession`), the bin handoff sending the hook as the
    caption seed, `blast_handoff_v1` declared and never consumed (legacy
    RECALL still writes it), storage writes inside `setQueue` updaters,
    `loadQueue` trusting unnormalized clips, and an in-flight
    `releaseFFmpeg` orphaning a live worker.

- **Phase 6 part 3 — auto-promotion (`924e0eb`): DONE.** Taken first because
  it is the highest-risk port in the phase: the only place one app writes
  into another's ledger with no human in the loop, and TOP CLIPS reads those
  entries back as personal proof. `computeAutoWinners` sliced out of the
  legacy IIFE and diffed over 14 fixtures. Every gate mutation-tested alone —
  all twelve fail a distinct test (five constants, `AUTO_HOOK_SIM`, and six
  logic branches). One fixture was wrong on first run and the differential
  caught it: 30,000 views on X against a 180 median is a real breakout and
  proved nothing about the cross-platform gate.

- **Phase 6 parts 1-2 — import + the link-less bug (`866feeb`): DONE.**
  Queue-wins-over-session, the unscoped quick key vs RECALL-scoped batch
  keys, the three-tier dedup identity, reversible healing, and enrichment
  that never overwrites a hand-edited hook. Fixes the legacy data-loss path
  at `pulse/app.js:1264`, where the backup importer dropped every link-less
  post — which import-from-blast routinely creates. The legacy loop is
  reproduced in the test rather than described, so the divergence stays
  deliberate: it drops both, the port keeps both, and the two agree exactly
  on posts that do have links. Five mutations each fail a distinct test.
  - **Process note (repeat of the queue.ts finding):** `import.ts` was swept
    into `ddf08da` by `git add -A` with no tests. It had no callers, so
    nothing was broken, and its tests landed immediately after — but that is
    twice now, and `git add -A` is the cause both times.

- **Phase 6 part 4c — the import differential (`ffaf539`): DONE.** The Fable
  audit's finding: `importClipRecord` had 29 behavior tests but, unlike the
  promotion block, was never sliced and diffed. 27 fixtures now run through
  both engines with the whole posts array and counter set diffed rather than
  spot-asserted. Mutation testing found a real gap the corpus missed TWICE:
  removing `captionHook`'s 300-char cap survives, because `makePost` slices
  twice and cannot observe it. The cap is load-bearing in exactly one place —
  `enrichPost` COMPARES the capped output to the stored hook, and an uncapped
  comparison never matches, so enrichment silently stops replacing a
  caption-derived fallback with a real hook.

- **Phase 6 part 4a — healers + snapshot math (`af9667e`, `d2a001f`): DONE.**
  Both healers sliced and diffed; ported as pure functions returning new
  arrays where legacy mutates in place, with tests asserting the input is
  untouched so the deviation is real rather than nominal, plus idempotence
  across the whole corpus. Ten mutations on the healers and six on the
  snapshot math, each failing a distinct test. Preserved quirks:
  `latestSnap` is largest-elapsed not most-recent; velocity may go negative;
  `recordSnapshot` does NOT dedupe a same-minute reading (heal is the only
  deduper, and collapsing here would change what a later merge sees). One
  test defect fixed test-side — I asserted -400 views/hr as -800, and the
  differential had already agreed with the port on that case.

- **Phase 6 part 4b — ledger write-back (`0708f57`): DONE.** The stack's one
  cross-app write. Six tests exist purely to prove neither id namespace can
  reach the other's rows or a HOOKLAB-native entry. Preserved: `patternName`
  is not carried; an unknown family stays "unknown"; views stay empty rather
  than "0"; the notes string keeps its trailing space; a failed write does
  NOT stamp the post. Retractions are tombstoned, and `autoSame` includes the
  pattern fields so a late-arriving pattern updates rather than no-ops. Seven
  mutations, each killed.

- **Phase 6 part 4d — the section (`ac09371`): DONE.** Boot heals before it
  paints; one ref-backed mutation path so the promotion engine cannot be
  bypassed; two deliberately different views (by-clip judges, by-platform is
  the walk-down list where Enter advances to the next VISIBLE input);
  sessionStorage view state; event-driven YouTube checks filtered to what is
  actually due. **Recorded deviation:** after a manual add this runs a
  due-filtered check where legacy sweeps every post in the library
  (app.js:1235) — same trigger, far less quota. Three test defects found and
  fixed test-side, the interesting one being that `addInitScript` re-runs on
  every navigation, so the reload was re-seeding the damaged posts and the
  healers were correctly merging again; the idempotence check was meaningless
  until that was guarded.

- **Phase 6 code review (`d557ff9`): 2 HIGH, 5 MEDIUM, 5 LOW. All fixed.**
  No CRITICALs, but for the second phase running, every finding but one was
  in the WIRING layer — the domain port, being differential- and
  mutation-tested, held. That is now a pattern worth acting on rather than
  noting: the wiring has no tests at all.
  - **HIGH-1 — the YouTube key never reached PULSE.** Settings writes the
    shared `stack_settings_v1`; PULSE read only its own blob, so
    auto-tracking was permanently dead for anyone who had not previously run
    legacy PULSE in the same browser. `resolveKeys` existed with ZERO callers
    anywhere in src/. Wiring it also fixes the reverse: clearing the key in
    Settings now actually stops this section sending a revoked credential.
  - **HIGH-2 — a stale input could silently retract an auto-promotion.**
    `ViewsInput` initialized once and never resynced, so a reading arriving
    from an auto check or another tab left the box holding the OLD number,
    highlighted as if edited. RECORD then wrote the stale figure back as a
    fresh manual reading, dropping the post below its cutoff and tombstoning
    its ledger row so a sync could not restore it.
  - **The healers ran AFTER the first paint** — they were in an effect, and
    two comments claimed otherwise. Moved into the state initializer.
  - Three of legacy's four auto-check triggers were missing (section open,
    after import, link pasted from the clip view). Without them an imported
    batch was never fetched, and the 1h/2h/6h checkpoints are unrecoverable
    because a later reading covers them without backfilling.
  - `tombstone()` threw on a full store, and the boot healers call it before
    commit — blanking the section on every load with no way to free space.
    Now swallows, as legacy does.
  - `importBackupPosts` now normalizes at the boundary; a caption-less post
    threw during render on every load once persisted.

- **Standing lesson for Phases 7-10:** two consecutive reviews found their
  defects almost entirely in React hooks and components, and zero tests
  touch that layer. Phase 9's committed E2E suite should be brought forward
  in spirit — at minimum, the mount/boot sequence of each section deserves
  a test before more UI is layered on it.

- **Then Phases 7-10:** cross-section flows + polish, accessibility + PWA,
  the committed E2E suite, and deploy + live verification.

- 706 unit tests, 13 headless suites green (41 of them new PULSE checks).

- **Phase 7 — cross-section flows + polish.** Commit `460fd8c`.
  - The dead echo-guard in `usePulse` is gone: the subscriber now compares
    the RAW string the hook itself last wrote, so a local save no longer
    re-enters the cross-tab path, re-runs `syncAutoWinners`, and replaces
    `posts` with a parsed clone that invalidated every grouping memo.
  - `HandoffLink` gives the handoff notices somewhere to go — RECALL's
    send-success offers OPEN BLAST, PULSE's ledger notice offers OPEN
    HOOKLAB. Deliberately links, not redirects: the creator is usually
    mid-batch and being teleported out of it is worse than a dead end.
  - Real empty states for RECALL's zero-hit search and HOOKLAB's
    pre-generation view. BLAST's queue was inspected and skipped — `loadQueue`
    guarantees the Quick post, so an empty-list branch would be dead code.
  - `seedThemeFromLegacy` gained the 10 tests it never had, pinning the
    hooklab → blast → pulse order, the bare-vs-JSON-quoted tolerance, junk
    rejection, and that a legacy theme key is never written back.

- **Phase 7b — the HOOKLAB AI path.** A parity gap the Phase 7 audit found:
  `underwriteWithAI` exists in the legacy app and was specified in the
  Phase 3 spec, but the port's UNDERWRITE button was offline-only.
  - `src/domain/hooklab/ai.ts` ports the prompt builder, the reply parser,
    and the attach step from `Hooklabs/app.js:593-777`, with all the caps
    verbatim (14 patterns, 15 ledger entries, 12 comps, 2500 chars of source
    material, 3 CTAs, 20 results) and the thinking-dependent token cap —
    thinking tokens count against the output budget on Gemini, so a fixed cap
    would truncate the JSON itself.
  - **The honesty rule is the point of the file.** A hook naming a pattern
    that does not resolve tries a name match and is then DROPPED. Attaching
    it to `selected[0]` — which is what a "just pick something" fallback
    would do — would show that line with a win rate, a badge and evidence it
    never earned. The slot is instead backfilled by the offline pass and
    labelled SCAFFOLD FILL, so every card says truthfully where its wording
    came from.
  - 25 differential tests slice `entryMedium` → `render` out of the legacy
    IIFE and diff the port against it. Six mutations, all caught — the last
    only after adding a 40-duplicate-patternId fixture, because the result
    cap of 20 is unreachable from 14 selected patterns unless the model
    repeats itself.
  - `GenerateView` gained the missing brief fields (source material, goal),
    the Hooks / Angles / CTAs tabs, a visible offline fallback when the call
    fails, and a per-card AI DRAFT vs SCAFFOLD FILL badge with its grounding
    line. Model output renders as text nodes, never HTML.
  - Verified headlessly with the provider stubbed by interception: 29 checks
    covering the orphan-hook drop, the backfill labelling, name-matched
    resolution, an unknown CTA id falling back rather than vanishing, and the
    prompt actually carrying the creator's own ledger, brand voice and source
    material.
  - **Where the headless suites live (correcting the record across every
    phase).** They are a scratchpad harness run manually against
    `vite preview`, NOT committed to this repo — `tests/e2e/` is empty and
    there is no `playwright.config.*`. Earlier log entries say "verified
    headlessly" without saying that, which reads as though the verification
    is reproducible from a clone. It isn't yet. Committing them IS Phase 9,
    and until that lands, every headless claim in this log means "run by hand
    at the time of the commit". Called out by the Phase 7b review, and it is
    the fair criticism: the layer these suites cover is precisely the layer
    the last three reviews found their defects in.

- **Phase 7b review-lite and its fixes.** The domain port held — every cap,
  call param, the scoring formula, the comp thresholds and the CTA fallback
  were independently re-derived from the legacy source and matched. One real
  defect in it, and the rest exactly where the standing lesson predicted.

  - **HIGH — `attachHooks` used the wrong status ladder.** The legacy AI path
    does not call `statusFor`; it writes its own ladder inline
    (`Hooklabs/app.js:721-724`) which differs in BOTH directions: no
    "mixed personal signal" rung, and a comp-similarity rung `statusFor`
    lacks entirely. The port's `compMatch` spread into the argument looked
    like it preserved the comp rule and was dead code. Consequence: a drafted
    line echoing a stored market comp on a sub-0.8 pattern rendered a card
    that contradicted itself — "Similar to market comp: …" underneath a
    HYPOTHESIS badge — and in the other direction it could claim `market`
    off a record the creator's own numbers call ambiguous. Now an explicit
    `aiStatusFor`, with the offline backfill correctly still on `statusFor`.

    The existing 25 differential tests could not catch it: every pattern in
    the default top-14 is at or above 0.84 strength, so the `strength >= 0.8`
    rung short-circuits both ladders. Three new tests pull in the `tactical`
    angle, where question-bait (0.79) makes the selection. Reaching the
    mixed-personal band took more care still — two same-family entries score
    0.55 fatigue and drag the pattern out of the top 14, so ten unrelated
    entries go in first to push the pair out of fatigue's 10-entry window
    while `familyStats` still counts them. Without that the mutation stayed
    alive, which is the suite admitting the rule was asserted by nothing.
    All three ladder mutations now killed.

  - **brandVoice was never passed**, so prompt rule 3 was permanently inert.
    Read from `hooklab_settings_v1`, which migrating users already have.
  - **A successful call yielding zero usable hooks reported success.** When a
    model paraphrases pattern ids past what the name match catches, every
    hook is correctly dropped and the user gets 14 scaffold fills, a paid API
    call, and no message — indistinguishable from an offline run. Both the
    all-dropped and the partially-dropped case now say so.
  - **No `withJsonRetry` / `partialOnTruncate`**, unlike every other AI call
    in the repo. HOOKLAB asks for 14 hooks plus 3 CTAs against its own token
    cap, so a long reply hits MAX_TOKENS and was discarded whole — even
    though `attachHooks` is built to backfill a partial one. `onPhase` is
    wired too, so a silent OpenRouter→Gemini switch is now reported.
  - **A tab switch destroyed an in-flight generation.** Thinking is on by
    default, so checking the ledger mid-wait is normal; the user returned to
    the pre-generation empty state with no sign the request had happened.
    GENERATE now stays mounted behind `hidden`. LEDGER and BANK stay
    conditional — LedgerView's one-shot prefill relies on remounting.
  - Smaller: the CTA engagement boost is now computed from the ledger as
    legacy does; the keyless path says it ran offline instead of silently
    showing scaffold fills; `goal` no longer vanishes from the prompt when
    undefined (`JSON.stringify` drops the key); hook cards key on the
    candidate id so a stale COPIED state can't survive a regeneration.
  - Four wiring mutations validated against a rebuilt bundle — each new
    headless check fails without its fix.
  - 744 unit tests, 15 headless suites (297 checks), typecheck and build
    green.

- **Phase 9 — the committed E2E suite.** Brought FORWARD of Phase 8 (user
  approved): three consecutive reviews found their defects in untested React
  wiring, and Phase 8's own work — a focus trap, a tablist refactor, a service
  worker — is more of exactly that layer. Landing the net first means Phase 8
  is the first phase in this project with a regression net under it.

  - **The audit finding first.** `parseAIReply` threw a plain `Error`, and
    `shouldRetryAsJson` keys on a tagged `nonJson` property — so wrapping the
    HOOKLAB call in `withJsonRetry` was inert for the exact case it exists to
    handle. Likewise `partialOnTruncate` stopped the provider throwing on
    MAX_TOKENS, but the parser had no salvage step, so the truncated partial
    was discarded before `attachHooks` could backfill it. Both fixed: a tagged
    `NonJsonReplyError`, and a brace-scanning salvage that keeps the COMPLETE
    hook objects out of a cut-off array and drops the half-written one (a
    partial object has no trustworthy patternId, which is the whole provenance
    contract). Both mutation-proven.
  - `src/domain/json-scan.ts` extracts the escape-aware scanners rather than
    carrying a second copy of that fiddly loop; BLAST's caption salvage now
    uses them too, and its 17 tests prove the refactor.
  - `playwright.config.ts`: `tests/e2e`, chromium, ONE port, `webServer`
    building and previewing at the real base path. That retires the five
    hand-started preview ports the scratchpad suites each hardcoded.
  - **All 15 scratchpad suites are now committed specs**, translated 1:1 —
    every `check()` became an `expect(cond, name)` with its diagnostic
    preserved, every `page.route` stub and `__seeded` guard kept verbatim.
    Assertion counts match the originals exactly. Each group was verified at
    `--repeat-each=10` (150 runs, zero flakes) rather than "passed once".
  - **Two new specs the plan named and nothing had covered:**
    - `critical-path.spec.ts` — the whole loop in one run: a moment binned in
      RECALL, sent to BLAST, captioned, marked posted, imported to PULSE,
      measured at 30k against a 2k median, landing as a `pulseauto_` entry in
      HOOKLAB with its evidence stated. Writing it surfaced three things no
      single-section spec could: a plain bin leaves `hookText` empty (that is
      TOP CLIPS' field) and PULSE derives the hook from the caption instead;
      the by-clip group label is the clipKey, not the hook; and clicking the
      platform toggle blind switched TikTok OFF, sending the post to a
      platform with n=1, so the run reached the end with nothing promoted and
      nothing visibly wrong. That last one is the shape of bug this spec
      exists for.
    - `coexistence.spec.ts` — seeds legacy-shaped state for all four apps,
      drives one real mutation per section, then validates every touched key
      against the shapes the STILL-DEPLOYED apps parse: BLAST's ms-epoch
      numbers vs HOOKLAB's ISO strings, the 12-field session projection,
      `blast-theme`'s hyphen left untouched, and the library still in
      IndexedDB where legacy reads it. Guarded against vacuity — it first
      proves the mutations landed, because every validator returns "no
      problems" for an empty collection.
  - `ci.yml` runs typecheck + unit + e2e on push and PR; `deploy.yml` gains
    the e2e step BEFORE the build, since Pages has no staging step to catch a
    regression later. Both upload the Playwright report on failure.
  - **A seeding lesson worth keeping:** `addInitScript` is serialized and run
    in the PAGE, so a module-scope const from the test file is undefined
    there. Setting the `__seeded` guard FIRST then throwing left the guard
    standing over a half-written seed and every later navigation skipping —
    the failure surfaced four steps downstream, pointing at the wrong thing.
    The guard now goes last.
  - 748 unit tests, 17 e2e specs (~300 assertions) green; typecheck and build
    clean. The scratchpad copies are retired: one source of truth.

- **Phase 9b — making CI actually pass on a fresh runner.** The Phase 9 audit
  caught what local green had hidden: ci.yml run 1 died in 28 seconds with
  `ENOENT /home/runner/work/Creators-Stack/recall/topclips.js`, before a
  single test executed — so the e2e step had still never run on a runner at
  all.
  - Fifteen unit test files read the ORIGINAL apps off disk and diff the
    ports against them, resolving `../../../<app>/…` — siblings of the
    workspace. Locally those siblings are just there; a fresh runner checks
    out only this repo. It is the scratchpad lesson one level deeper:
    "reproducible from a clone" has to mean a clone of everything the tests
    actually READ, not just the code they test.
  - Both workflows now shallow-clone `recall`, `Hooklabs`, `blast` and
    `pulse` as siblings right after checkout. **Cloned, not vendored,** on
    purpose: a copy checked into this repo would drift from what is deployed,
    and a differential against a stale copy proves nothing — it would keep
    passing while the thing it claims to match moved. Default branch for the
    same reason: deployed IS main. `actions/checkout` cannot write outside
    the workspace, so these are plain `git clone`s.
  - Verified before pushing rather than after: a shallow clone of each repo
    provides every one of the seven files the tests resolve, and all four are
    byte-identical to the local copies the suite was developed against — so
    CI diffs the same sources, and a green run means the same thing a green
    local run does.
    CI run 2 is GREEN end to end on the runner: clone 3s, typecheck, 748
    unit tests (differentials included) 8s, chromium install 37s, **17 e2e
    specs 32s**. Phase 9 is only now actually done — locally green had been
    hiding a workflow that could never have passed.

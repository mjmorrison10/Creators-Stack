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

- **Phase 5 (next up):** BLAST — the queue over `blast_queue_v1`, per-platform
  caption limits, the forward-only status machine, web intents and mobile app
  schemes, AI suggestions carrying hooklab-winner evidence, ffmpeg 9:16 crop,
  and the `blast_session_v1` projection writer wired to every Quick-clip
  mutation through a single writer module.

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

- **Phase 2, remaining:** `services/llm/gemini.ts` + `provider.ts`
  (`withGeminiFallback` lives in blast/app.js, not llm.js — it belongs in the
  provider so every section gets it), `models.ts`, `youtube.ts`, `ffmpeg.ts`,
  `data/stackdata/drive.ts`, and the Settings UI. The merge engine is still
  tree-shaken out of the bundle until Settings imports it.

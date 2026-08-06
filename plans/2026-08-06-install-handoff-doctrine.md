---
approved: 2026-08-06
---

# Bootstrap Creators-Stack with the Fable→Opus handoff doctrine

## Goal

Persist the Plan Handoff Doctrine (Fable 5 plans and audits; Opus executes)
into this repo as project instructions. The doctrine previously lived only in
the session prompt, so it evaporated when a session ended.

This is the repo's first commit — before it, `Creators-Stack` was completely
empty (`git ls-remote origin` returned zero refs; the working tree held
nothing but `.git`).

## Scope

**This repo only.** The sibling stack repos — `recall`, `blast`, `Hooklabs`,
`pulse`, `agency-agents` — were explicitly left untouched.

Known divergence, deliberately not fixed: `recall/CLAUDE.md` and
`blast/CLAUDE.md` end their doctrine with a note saying the planner/executor
model pairing was "intentionally dropped … model selection is handled
manually for now." That contradicts the doctrine installed here. The stack
carries two different doctrines until that's reconciled.

## Files touched

| Path | Action |
|---|---|
| `CLAUDE.md` | create |
| `plans/2026-08-06-install-handoff-doctrine.md` | create (this file) |

## Steps

1. **Write `CLAUDE.md`.** Base the wording on the canonical stack version
   (`recall/CLAUDE.md`), with three changes:
   - Omit the "intentionally dropped" note — it is what this change reverses.
   - Merge the model handoff into the existing four-phase spine (tagging each
     step with its owner) rather than appending a second, duplicate workflow
     section. Two competing definitions in one file is the failure mode this
     doctrine is meant to avoid.
   - Make the Shipping and Verification bullets **conditional**. Copied
     verbatim they assert a GitHub Pages deployment and a Playwright suite
     that do not exist in this repo, which would send a future agent to poll
     a nonexistent URL.

   Sections: doctrine intro + scope → Roles (model handoff) → Workflow
   (PLAN/Fable, APPROVAL GATE/User, EXECUTE/Opus, AUDIT/Fable) →
   Model-switch reminders → Standing workflow preferences.

2. **Seed `plans/`** with this file, rather than an empty `.gitkeep`. This
   satisfies the doctrine's own rule that plan files are committed with the
   work.

3. **Commit and push** to `claude/handoff-doctrine-fable-opus-4eekfe`.

## Deviations from the doctrine text, flagged at approval

- **A third model-switch reminder** (execution finished on Opus → switch back
  to Fable to audit) was added. The source doctrine names only two. The
  addition closes the loop the doctrine exists for, since AUDIT is a Fable
  phase and something must hand back to it.
- **A sentence resolving the carve-out collision** was added to Roles: the
  small-task carve-out skips the plan/approval ceremony, not the role split.
  Without it, "small tasks — just do them" appears to contradict "Fable never
  executes."

## Divergences forced by the unborn repo

The standing preference is a fresh branch off `origin/main`. This repo had no
`origin/main` — no refs at all. Therefore:

- The branch starts from the empty tree, not from `main`.
- **The pushed branch becomes the repo's default branch**, since GitHub points
  the default at the first branch pushed to an empty repo.
- **No PR was opened** — there is no base branch to target. Promoting this
  branch to `main`, or creating `main` from it, is a manual step in the
  GitHub UI.
- Until `main` exists, the "branch off `origin/main`" preference installed by
  this change is unsatisfiable *in this repo*. It becomes correct as soon as
  `main` is created.

## Rollback

The unborn state makes the usual commands wrong. Correct sequence by stage:

- **Before commit:** delete the two new files. `git reset --hard` does not
  work — it cannot resolve HEAD on an unborn branch.
- **After commit, before push:** `git update-ref -d HEAD` (the standard undo
  for an initial commit), then delete the files. `git reset --hard` would
  reset *to* the commit rather than removing it.
- **After push:** `git push origin --delete <branch>` is refused — it is now
  the default branch. Recovery requires the GitHub UI: push a placeholder
  branch, flip the default in settings, then delete; or delete the repo.

No other repo is touched, so nothing else can regress. No secrets, no
credentials, no executable code — two Markdown files.

## Verification

1. `grep -c "intentionally dropped" CLAUDE.md` → `0`.
2. All five sections present; Fable named planner/auditor, Opus executor; all
   three model-switch reminders listed.
3. Shipping/Verification bullets are conditional, not false claims about a
   Pages deploy or Playwright suite.
4. `ls -a` shows only `CLAUDE.md`, `plans/`, `.git` — no stray `.claude/`.
5. **Isolation (critical):** for each of `recall`, `blast`, `Hooklabs`,
   `pulse`, `agency-agents` — `git status --short` empty and
   `git rev-list --count origin/main..HEAD` is `0`.
6. `git ls-remote origin` returns the branch ref (it returned nothing before).

No tests or build to run — this repo has no code.

## Execution log

- Plan drafted on Opus, reviewed by Fable (verdict: APPROVE WITH CHANGES).
  Four blocking issues folded in before approval: broken post-push rollback
  (default-branch deletion refused), invalid `git reset --hard` on unborn
  HEAD, verbatim import of repo-specific Shipping/Verification claims, and
  the missing execute→audit reminder.
- Approved 2026-08-06.
- EXECUTE: `CLAUDE.md` and this plan file created; committed and pushed to
  `claude/handoff-doctrine-fable-opus-4eekfe`.

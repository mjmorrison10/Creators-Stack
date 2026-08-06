# CLAUDE.md

## Plan → Approve → Execute → Audit Doctrine

For big or risky work, follow this workflow. Small, low-risk tasks skip it —
just do them.

**Scope:** anything that touches core systems, production, data, or is hard
to reverse (auth, payments, database schema/migrations, deploys, deleting or
overwriting data, force-pushes). Routine edits, docs, and small bug fixes
don't need this ceremony.

### Roles (model handoff)

- **Fable 5** — planner and auditor ONLY. Used for planning big/risky
  changes and for auditing completed work. Fable never executes.
- **Opus** — the daily executor. Opus does all the actual work, following an
  approved plan file.

The small-task carve-out above skips the plan/approval *ceremony*, not the
role split: a small task still gets executed by Opus, it just doesn't need a
plan file and an approval gate first.

### Workflow

1. **PLAN (Fable).** Before touching anything, write a complete step-by-step
   plan to `plans/YYYY-MM-DD-<task>.md`. Include: goal, exact steps,
   files/systems touched, rollback steps, verification checks. Do not
   execute yet.
2. **APPROVAL GATE (User) — hard rule.** No execution until the user has
   explicitly reviewed and approved the plan *file*. "Go", "resume", or "do
   X" is not approval of an unreviewed plan — approval means the user has
   seen the plan and signed off on it specifically. Once approved, record it
   in the plan file's frontmatter: `approved: YYYY-MM-DD`.
3. **EXECUTE (Opus).** Follow the plan file step by step, exactly as
   written. If reality diverges from the plan, stop and report — don't
   improvise on core systems. Log what was done in the plan file as you go.
4. **AUDIT (Fable).** After execution, verify every step of the plan against
   what actually happened (check, don't just trust the log). Report PASS/FAIL
   per step.

### Model-switch reminders

Remind the user at phase boundaries:

- Planning something big while NOT on Fable → suggest switching to Fable.
- Starting to execute while ON Fable → tell them to switch to Opus
  (`/model`).
- Execution finished while on Opus → suggest switching back to Fable for the
  audit.

## Standing workflow preferences (all sessions)

- **Branching:** always `git fetch origin` first (local refs go stale),
  then a fresh `claude/<feature>` branch off `origin/main` — one branch
  per feature. Never reuse a branch whose PR has merged; never force-push.
- **Shipping:** push with `-u`, open a PR, squash-merge. If this repo gains
  a GitHub Pages deployment, it deploys from main — after merging, poll the
  live URL with a cache-buster until the change is verifiably live.
- **Verification before pushing:** exercise the change end-to-end before
  pushing. Once there's a web app here, that means running it headlessly
  (Playwright), stubbing AI endpoints by intercepting the network request —
  ES module bindings can't be monkey-patched.
- **Doctrine plans:** `plans/YYYY-MM-DD-<task>.md` files are committed
  with the work, `approved:` frontmatter filled in.

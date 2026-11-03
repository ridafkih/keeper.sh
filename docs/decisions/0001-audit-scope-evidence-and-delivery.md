# 0001. Audit scope, evidence standard and delivery

- Status: accepted
- Date: 2026-11-03
- Tasks: all (C1, C2, S-ENGINE, S-CALDAV-ZONE, S-RECUR, S-FREETIME, S-MCP, S-API-TIME, S-OUTLOOK-WRITE, S-GOOGLE-STRICT, S-SYNC-RANGE, S-FEED-EXDATE, S-ICU-STARTUP, INTEGRATE)

## Context and problem statement

Two time-zone bugs shipped fixes today (#1093 stale tzdata, #1094 Manila RDATE). The owner asked:

> Can you do a full audit of similar time zone discrepancies that might cause issues for users?

The research synthesis lists candidate findings A to K plus hardening items. Thirteen build tasks and one integration task act on them in parallel. They need one shared rule for what counts as a confirmed finding, how evidence is produced, how work is committed and how it leaves the machine.

## Decision drivers

1. The owner's words: a *full* audit of discrepancies that cause *issues for users*. The output must be trustworthy: what is broken, for whom, and what got fixed.
2. Owner rules: fix root problems, not symptoms; fail fast, never fall back; no PRs on public repos on our own (keeper.sh is public); granular commits; the owner must not be the one who finds the bugs.
3. Disk is tight (about 18 GB free) and the machine has a load ceiling.

## Considered options

- A. Open a PR and treat green PR CI as done.
- B. Run the CI-equivalent checks locally, push the branch, open no PR.
- C. Treat every changed behaviour as a finding.
- D. Count something as a confirmed finding only when a committed test fails on origin/main through code users run today and passes on the branch; everything else is labelled hardening or an unconfirmed risk.

## Decision outcome

B and D.

### Binding rules

1. **Confirmed finding** = a test that fails with an *assertion* (not an import, collection or type error) on origin/main (`ab4ee659`) through an entry point that exists on main (for example `parseICalCalendarsToRemoteEvents`, `createIcsSourceFetcher`, `materializeRecurrenceEvents`, `serializeOutlookEvent`, `findFreeTime`, the MCP `get_events` tool, `getStartOfToday`, `generateIcsCalendar`/feed builders, the REST mutations) and passes on `fix/tz-audit`.
2. Contract tasks (C1, C2) are exempt from rule 1 for their new exports, but any user-facing claim built on them must be proven by a slice's boundary test.
3. A change with no red-before test is **hardening** and is reported as such (S-GOOGLE-STRICT, the strict Outlook parse, the dead Outlook recurrence serializer, S-SYNC-RANGE and S-ICU-STARTUP for hosted users). Cases that already pass on main stay as labelled regression pins and are never described as fixed.
4. Red-before evidence is produced in a copy under `/tmp` (files restored with `git -C ~/keeper-wt-tz-audit show origin/main:<path>`), never by `git checkout` inside a shared worktree, never in `~/keeper.sh`.
5. Zone-dependent expected values are hand-written UTC literals, never derived from `Intl` or the code under test. Any vitest run outside a package script sets `ICU_TIMEZONE_FILES_DIR` to the vendored `docker/icu-timezone` (2026f). The local Bun ICU is 74.2 and stale; never draw a conclusion about a recently changed zone (Edmonton, Vancouver) from it. Tests that care about server TZ run under at least `TZ=UTC` and `TZ=America/Edmonton`, in a separate process per zone (never by flipping `process.env.TZ` mid-test).
6. No per-zone branches (`if (zone === "...")`) anywhere. No code comments in new code (`/project` style). Clear, self-descriptive names; new logic goes in its own small module rather than growing large shared files.
7. Commits: one logical change each, test and fix together (no red commit lands on the branch), staged by explicit path, author and committer `worm-agent-bot[bot] <336322275+worm-agent-bot[bot]@users.noreply.github.com>` (from env), trailer `Co-Authored-By: ridafkih <9158485+ridafkih@users.noreply.github.com>`. Never the `Worm <worm@rida.sh>` trailer.
8. Parallel slices each work in their own `git worktree add` checkout off `fix/tz-audit` (never `EnterWorktree`, never a shared checkout), and land on `fix/tz-audit` by rebase or fast-forward. `bun.lock` is never hand-merged: after a rebase, run `bun install` and commit the regenerated lockfile.
9. Slices do not push. INTEGRATE pushes `fix/tz-audit` once, after the full checks pass on the final HEAD, and opens no PR. Opening a PR is left to Worm and the owner.
10. "Done" for the branch = CI-equivalent checks run locally under Bun 1.3.11 (`~/.bun-1.3.11/bin`, the `packageManager` pin CI resolves): `bun install --frozen-lockfile`, `bun run types`, `bun run lint`, `bun run unused`, `bun run test` with a throwaway Postgres 17.6 for the database suites.
11. Fixtures are small (whole fixture directory under 1 MB), hand-written or generated in memory from ICU, and contain no personal data (placeholder hosts, no names, emails or phone numbers).
12. No pattern kills (`pkill -f`, `killall`); stop only processes and containers by exact PID or name. No simulator or iOS slot is needed by any task.
13. Reach numbers are counts only (users, calendars, runs), read-only from Loki/Prometheus, never identifiers.

### Consequences

- Good: the report can say precisely what was broken, for whom, and what was fixed; hardening is not inflated into findings.
- Bad: some slices must write boundary-level tests that are slower than unit tests; INTEGRATE may bounce work back.

## Agent context

- Owner words: see the quote above.
- Research: `/Users/villager/.worm/runs/20261103-112532-tz-audit/research.md`
- CI: `.github/workflows/checks.yml` (runs on `pull_request` only, Postgres 17.6 at lines ~201 and ~335)
- Package test script pins `TZ=UTC` and `ICU_TIMEZONE_FILES_DIR=../../docker/icu-timezone`: `packages/calendar/package.json:18`
- turbo strict env passes only `KEEPER_TEST_DATABASE_URL` through to tests: `turbo.json`
- Pre-push hook runs lint, types, unused and test: `lefthook.yml`

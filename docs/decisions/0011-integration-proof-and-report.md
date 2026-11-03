# 0011. Integration: proof, reach and the audit report

- Status: accepted; the last sentence of rule 6 is superseded by 0017
- Date: 2026-11-03
- Tasks: INTEGRATE (owner); constrains every slice's test design

## Context and problem statement

The owner wants a trustworthy audit: what is actually broken, for whom, and what got fixed. Thirteen slices land on `fix/tz-audit`. Someone must prove each claim against today's main, run the checks CI runs, measure reach, push, and write the report without inflating it.

## Decision drivers

1. Owner words: "full audit of similar time zone discrepancies that might cause issues for users".
2. The handed verification `(cd packages/calendar && TZ=America/Edmonton bun run test)` silently runs under UTC (the script pins `TZ=UTC`; turbo drops TZ). That is the hidden-environment class of bug this audit is about.
3. No PR on the public repo (rule 206); no production writes; counts only.

## Decision outcome

### Binding rules

1. Toolchain: Bun 1.3.11 first on `PATH` (the `packageManager` pin CI resolves). Throwaway `postgres:17.6-alpine` container named `keeper-tz-audit-pg` on port 55432 for `KEEPER_TEST_DATABASE_URL` and `MIGRATION_TEST_DATABASE_URL`; stopped by that exact name.
2. TZ matrix by calling vitest directly: `TZ=<zone> ICU_TIMEZONE_FILES_DIR=../../docker/icu-timezone bun x --bun vitest run` in packages/calendar, services/api, services/cron and services/worker, zones America/Edmonton, Pacific/Auckland, Asia/Kolkata. Baseline the same matrix on an origin/main copy; failures present on main are reported as pre-existing.
3. Red state: one APFS clone (`cp -cR`) at `/tmp/tz-main-state`, its `.git` file deleted immediately, every non-test source path changed in `origin/main..HEAD` restored from origin/main and every added source file deleted. Each finding's tests are copied in alone and run; only assertion failures through main entry points count (ADR 0001 rule 1). Collection/import failures are bounced to the owning slice for a boundary-level test.
4. Finding → owner map: A S-CALDAV-ZONE; B1, B2, C S-ENGINE; D C2 + S-ENGINE; J S-RECUR; E S-FREETIME; F S-MCP; I S-API-TIME; K S-OUTLOOK-WRITE; H S-ICU-STARTUP; sync range S-SYNC-RANGE; feed EXDATE S-FEED-EXDATE; Google strict S-GOOGLE-STRICT. Shared files are attributed by fix commit and named as shared.
5. Before counting K, read ingest to see which `startTimeZone` values can reach the Outlook writer; downgrade to hardening if only resolvable zones arrive. Also probe the MCP/API neighbour-day all-day inclusion (ADR 0007 rule 5) and report it as confirmed or not.
6. Bounces go through the run ledger (kept outside the repository) with command, output, file:line and what done means. INTEGRATE edits no source and makes no commits.
7. Reach: per-day Loki instant queries for 7 days, server-side aggregation, counts only; Grafana credentials loaded in a subshell from a local env file outside the repository, never printed. Findings without a log signal are "not countable" with the reason.
8. Self-heal per fix is proven by citing the code path (file:line) that re-reads affected copies (ICS re-parse every tick, CalDAV full reads, `localHashChanged`, 7-day OAuth window, Outlook read-back); anything needing a one-off job is named. Note S-RECUR's snapshot-hash re-ingest question.
9. Hygiene: every commit author and committer `worm-agent-bot[bot]`, trailer `Co-Authored-By: ridafkih <9158485+ridafkih@users.noreply.github.com>`; `gitleaks detect --log-opts origin/main..HEAD`; personal-data sweep of fixtures; fixtures under 1 MB.
10. Push `fix/tz-audit` once all checks pass on the final HEAD; verify `git ls-remote` equals HEAD. No PR.
11. Report (returned as the run's output, never committed): confirmed issues (what, providers, zones, reach counts, root cause file:line, fix commit, test, red excerpt, self-heal); hardening; pre-existing failures; unconfirmed risks (R1 Exchange unlisted IANA, fold-hour interop, client tzdata age, pre-1972 seconds offsets, NULL isAllDay inference, all-day local-midnight floor, iCloud calendar-timezone shape, CalDAV zone-only update if not reproduced, K if downgraded, neighbour-day inclusion if not confirmed); remaining gaps (declared non-IANA DST recurring series withheld; custom fixed offsets with no IANA equivalent; filtered sub-daily fold skip); the out-of-class Outlook seconds-churn lead; owner decisions X1 (gap ignore vs shift), X4 (UTC vs Windows ids), X5 (Bun pins); policy changes (IANA wins over declared VTIMEZONE; sync window on the UTC grid; new API 400s; startup refuses stale/missing tz data); telemetry recommendation (TZID class field on unsupported reasons); and a plain statement that nothing is deployed.

### Consequences

- Good: no claim without an assertion-level red on today's main; environment coverage is real.
- Bad: late bounces cost round-trips; reach numbers are pre-deploy only.

## Agent context

- `.github/workflows/checks.yml` (Postgres 17.6, setup-bun v2 reading packageManager)
- `packages/calendar/package.json:18`; `turbo.json`; `package.json` (`packageManager: bun@1.3.11`)
- Research reach sources G2, G5, Q8: the audit research notes (kept outside the repository)

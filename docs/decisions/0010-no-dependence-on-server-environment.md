# 0010. Results never depend on the server's TZ or on unvetted tz data

- Status: accepted
- Date: 2026-11-03
- Tasks: S-SYNC-RANGE, S-ICU-STARTUP (owners)

## Context and problem statement

- `core/sync/sync-range.ts` computes "today" with `setHours(0,0,0,0)` and shifts with local `setDate`/`setMonth`, so sync-window edges move with the server's TZ (deliberately local since #452, `fd2f5b12`), unlike `time-range.ts`'s UTC day grid.
- Finding H: from-source `start`/`dev` scripts of api, cron, worker and mcp don't set `ICU_TIMEZONE_FILES_DIR` (only `test` does), so self-hosters running from source get the v2.28.9 one-hour error for Alberta, BC, Manitoba, NWT, Cuba and Morocco again. Docker images set it (`docker/services/Dockerfile:25`, `docker/standalone/Dockerfile:26`).

## Decision drivers

1. Owner: discrepancies like today's stale-tzdata bug; "Never fall back to an environment variable, always fail fast"; fix root problems.
2. Be honest about reach: hosted production runs with TZ unset and uses Docker, so both are latent there.

## Considered options

- Sync range: UTC day grid (one module) vs threading each user's zone through every caller.
- tz data: start-script fix only (the handed "stop if Bun exposes no tz version") vs start-script fix plus a fail-fast check on the configured data directory's version.

## Decision outcome

UTC day grid for every date operation in `sync-range.ts`. Start-script fix plus a fail-fast check. Bun exposes no runtime tz-data version (`process.versions.tz` is undefined on 1.3.6 and 1.4.2), so the check reads `<ICU_TIMEZONE_FILES_DIR>/VERSION`, not a zone probe, and CI ties that file to the TZVersion inside the vendored `zoneinfo64.res`.

### Interface contracts (exact)

```ts
// packages/calendar/src/core/sync/sync-range.ts — signatures unchanged
getStartOfToday(...): Date; // UTC midnight of the given instant
// shiftDateByMonths and the "days" branch of shiftDateByRange use UTC getters/setters

// packages/calendar/src/utils/timezone-data-currency.ts
const REQUIRED_TIME_ZONE_DATA_VERSION: string; // "2026f", equals docker/icu-timezone/VERSION (test-enforced)
const assertTimeZoneDataCurrent: (runtimeVersion: string | undefined, requiredVersion: string) => void; // throws when older, unknown or malformed
const readConfiguredTimeZoneDataVersion: (directory: string | undefined) => string | undefined;
const exitUnlessTimeZoneDataCurrent: (directory: string | undefined) => void; // stderr one line + process.exit(1)
```

Version format follows the repo's validator `/^\d{4}[a-z]$/`; compare year then letter; anything else throws.

### Binding rules

1. Sync-range tests run each zone in a subprocess (`Bun.spawnSync([process.execPath, "-e", script])`, env `TZ` and absolute `ICU_TIMEZONE_FILES_DIR`), build every `Date` inside the child, assert exit code 0 and empty stderr, and compare absolute ISO-Z strings. Zones: UTC, America/Edmonton, Pacific/Auckland, America/Los_Angeles, Pacific/Kiritimati. Cases cover the anchor, a DST crossing and a month-end clamp west of UTC. The in-process test "anchors to local midnight in any server timezone" is removed (it encodes #452).
2. `OAUTH_SYNC_WINDOW_VERSION` is not bumped; whether stored sync tokens need a reset for TZ-set self-hosters is an open question for the report.
3. Consumer tests outside S-SYNC-RANGE that fail under a non-UTC TZ are reported to INTEGRATE, not edited.
4. Each service `index.ts` (api, cron, worker, mcp) calls `exitUnlessTimeZoneDataCurrent(process.env.ICU_TIMEZONE_FILES_DIR)` before its first top-level statement. The library never reads env itself.
5. `dev` and `start` scripts of the four services get `ICU_TIMEZONE_FILES_DIR=../../docker/icu-timezone`. Dockerfiles are not edited (already correct; s6 runs `dist/index.js` directly with the absolute ENV). Docker is verified by reading the files; no image build (disk).
6. `services/mcp/package.json` gains `"@keeper.sh/calendar": "workspace:*"`; the lockfile is regenerated with `bun install` per ADR 0001 rule 8. S-ICU-STARTUP is the only task that edits `packages/calendar/src/index.ts` (one added export line).
7. Report: H affects only from-source and direct-dist self-hosters; the check proves which data is configured, not what ICU loaded; breaking change for direct-dist runners without the env. Sync range is latent hardening for TZ-set self-hosters, reversing #452 on purpose.

### Consequences

- Good: window edges and tz rules no longer depend on how the server process was started; misconfiguration fails loudly instead of putting events an hour off.
- Bad: one-time window edge shift (up to ~14 h) for TZ-set self-hosters; services refuse to start without the env.

## Agent context

- Research finding H, X5
- `packages/calendar/src/core/sync/sync-range.ts`; `packages/calendar/src/core/events/time-range.ts`; `git show fd2f5b12` (#452)
- `docker/icu-timezone/VERSION`, `docker/icu-timezone/zoneinfo64.res` (TZVersion "2026f" as UTF-16LE near byte 2096); `scripts/update-icu-timezone.ts`
- `services/*/package.json`; `docker/services/Dockerfile:25`; `docker/standalone/Dockerfile:26`

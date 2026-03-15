# Sync Engine Overhaul

## Context

The current sync engine has 4+ cron jobs that create enormous backpressure, causing syncs to take hours instead of the promised 30 min (free) / 1 min (pro). Root causes: redundant iCal fetching, individual event pushes, poor locking, mixed ingestion/egress in the same job. 127 users, 21,066 events, only 5,762 with active mappings.

## Design Principles

1. **Idempotent** — any job can be interrupted at any point with no side effects
2. **Atomic writes** — no DB mutations until the very end of a job run
3. **Cancellable** — if the same calendar's job is called again, the in-flight run is abandoned
4. **Batch operations** — never push events individually
5. **No redundant fetches** — each source fetched exactly once per cycle

## Architecture

### Two phases, both cron-polled

**Phase 1: Ingestion** — pulls events from sources into `eventStatesTable`
**Phase 2: Egress** — pushes events from `eventStatesTable` to destinations via `eventMappingsTable`

Both run as cron jobs. Egress checks for "dirty" destinations (sources whose events changed since last egress).

### Existing schema kept as-is
- `eventStatesTable` — source of truth for pulled events
- `eventMappingsTable` — tracks what's been pushed to each destination
- `calendarSnapshotsTable` — iCal snapshots (used by ingestion, not re-fetched by egress)
- `syncStatusTable` — tracks last sync time per calendar
- `sourceDestinationMappingsTable` — which sources feed which destinations

---

## Implementation Plan

### Step 1: New ingestion job

**File:** `services/cron/src/jobs/ingest-sources.ts`

Single job that handles ALL source types (replaces `sync-sources-oauth.ts`, `sync-sources-caldav.ts`, `sync-sources-ical.ts`).

**Logic:**
1. Query all source calendars (pull-capable) grouped by type
2. For each source, increment Redis generation counter: `sync:ingest:gen:{calendarId}`
3. Fetch events from remote (dispatch to provider handler based on type):
   - OAuth (Google/Outlook): use sync tokens, fetch delta
   - CalDAV: use sync tokens, fetch delta
   - ICS: fetch full iCal, compare content hash to skip if unchanged
4. Compute diff in memory: compare fetched events against current `eventStatesTable`
5. Before writing: check generation is still current (if not, discard)
6. Single transaction: insert/update/delete in `eventStatesTable`, update `syncToken` on calendar, update `syncStatusTable`

**Concurrency:** Process sources with `allSettledWithConcurrency(sources, 5)` — 5 concurrent source syncs max.

**Schedule:** `@every_1_minutes`, immediate on startup

**Key difference from current:** ICS sources are fetched here (not separately), and the snapshot is only used as an optimization (skip if content hash unchanged). No separate snapshot-then-sync flow.

### Step 2: New egress job

**File:** `services/cron/src/jobs/push-destinations.ts`

Two instances: one for free (every 30 min), one for pro (every 1 min). Replaces `push-events.ts`.

**Logic:**
1. Query all users with active `sourceDestinationMappingsTable` entries for the target plan
2. For each user's destinations:
   a. Increment Redis generation counter: `sync:egress:gen:{destinationCalendarId}`
   b. Read current `eventStatesTable` rows for all mapped sources
   c. Read current `eventMappingsTable` rows for this destination
   d. Compute operations in memory (add/remove/update) using existing `computeSyncOperations` from `core/sync/operations.ts`
   e. **Batch** push operations to the provider (collect all adds, all removes)
   f. Before writing: check generation is still current
   g. Single transaction: insert/update/delete in `eventMappingsTable`, update `syncStatusTable`

**Concurrency:** Process users with `allSettledWithConcurrency(users, 3)` — 3 concurrent user syncs max. Within each user, process destinations sequentially to avoid rate limit issues with provider APIs.

**Key difference from current:**
- Does NOT re-fetch iCal sources (reads from `eventStatesTable` populated by ingestion)
- Batches push operations instead of individual event pushes
- Atomic write at end

### Step 3: Generation-based cancellation

**Module:** `packages/calendar/src/core/sync/generation.ts`

Simple Redis-backed generation counter:

```typescript
interface SyncGeneration {
  increment(key: string): Promise<number>;
  isCurrent(key: string, generation: number): Promise<boolean>;
}
```

Used by both ingestion and egress. Before any DB write, call `isCurrent()`. If false, silently discard all computed work.

This replaces the current `coordinator.ts` generation tracking which is more complex than needed.

### Step 4: Remove old jobs

Delete:
- `services/cron/src/jobs/sync-sources-oauth.ts` (+ test)
- `services/cron/src/jobs/sync-sources-caldav.ts` (+ test)
- `services/cron/src/jobs/sync-sources-ical.ts`
- `services/cron/src/jobs/push-events.ts`

Update:
- `services/cron/src/index.ts` — register new jobs
- `services/cron/src/utils/sync-calendar-events.ts` — likely delete or absorb into egress job

### Step 5: Update cron support utilities

- `services/cron/src/utils/get-sources.ts` — may need updates for unified source querying
- `services/cron/src/utils/source-plan-selection.ts` — keep, used by egress for plan filtering
- `services/cron/src/context.ts` — simplify if coordinator is replaced by generation counter

---

## Files to create

- `services/cron/src/jobs/ingest-sources.ts` — new unified ingestion job
- `services/cron/src/jobs/push-destinations.ts` — new egress job
- `packages/calendar/src/core/sync/generation.ts` — generation counter

## Files to delete

- `services/cron/src/jobs/sync-sources-oauth.ts` (+ `.test.ts`)
- `services/cron/src/jobs/sync-sources-caldav.ts` (+ `.test.ts`)
- `services/cron/src/jobs/sync-sources-ical.ts`
- `services/cron/src/jobs/push-events.ts`
- `services/cron/src/utils/sync-calendar-events.ts` (+ `.test.ts`)

## Files to modify

- `services/cron/src/index.ts` — register new jobs
- `services/cron/src/context.ts` — simplify coordinator setup
- `knip.json` — update cron job entry patterns if needed

## Existing code to reuse

- `packages/calendar/src/core/sync/operations.ts` — `computeSyncOperations()` for egress diff
- `packages/calendar/src/core/source/event-diff.ts` — `buildSourceEventsToAdd/Remove()` for ingestion diff
- `packages/calendar/src/core/source/write-event-states.ts` — `insertEventStatesWithConflictResolution()`
- `packages/calendar/src/core/oauth/source-provider.ts` — `OAuthSourceProvider` base class
- `packages/calendar/src/core/oauth/create-source-provider.ts` — source provider factory
- `packages/calendar/src/ics/utils/pull-remote-calendar.ts` — ICS fetching
- `packages/calendar/src/providers/*/source/provider.ts` — per-provider source implementations
- `packages/calendar/src/core/utils/concurrency.ts` — `allSettledWithConcurrency()`
- `packages/calendar/src/core/sync/aggregate-tracker.ts` — progress tracking for WebSocket broadcast
- `packages/calendar/src/core/sync/aggregate-runtime.ts` — Redis persistence of sync state

## Verification

1. `bun run types` — TypeScript compiles
2. `bun run test` — all tests pass (new tests for new jobs)
3. `bun run lint` — oxlint passes
4. `bun run unused` — knip passes
5. Manual test: create source + destination mapping, verify ingestion pulls events and egress pushes them
6. Verify generation cancellation: trigger two ingestions for same calendar, confirm only latest writes

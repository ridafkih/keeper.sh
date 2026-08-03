# Sync the self-attendee RSVP status for Google Calendar events

## Title

`feat(calendar): surface self-attendee responseStatus for synced Google events`

## Summary

Keeper deliberately strips attendee data on ingest and only persists availability
(busy/free/oof/workingElsewhere) plus title/description/location. This PR adds one
piece of attendee data back to the read path: **the calendar owner's own RSVP status**
(`accepted` / `declined` / `tentative` / `needsAction`) for Google-synced events.

Only the **self** attendee's `responseStatus` is extracted and persisted. Other
attendees' identities and responses are never stored or surfaced, preserving keeper's
privacy stance. The value is optional and defaults to `null` when the event has no self
attendee (e.g. events the owner created without invitees), so existing behavior is
unchanged.

The RSVP **write** path (updating your own response through keeper) already existed via
`services/api/src/mutations/providers/google.ts`; this PR closes the loop by making the
same `responseStatus` readable on the ingest/read side.

## What changed

**Source → normalized (Google provider)**
- `packages/data-schemas/src/index.ts` — added `attendees?` (reusing the existing
  `googleAttendeeSchema`) to `googleEventSchema`, so the Google events-list response
  validates and retains attendee data. `googleAttendeeSchema` was moved above
  `googleEventSchema` so it can be referenced.
- `packages/calendar/src/providers/google/source/types.ts` — added a
  `GoogleEventAttendee` shape + `attendees?` to `GoogleCalendarEvent`, and an optional
  `responseStatus?` field to the normalized `EventTimeSlot`.
- `packages/calendar/src/providers/google/source/utils/fetch-events.ts` — `parseGoogleEvents`
  now extracts the self attendee's `responseStatus` (mirroring the existing self-attendee
  lookup in the mutation path: `attendees.find((a) => a.self === true)`).

  Note: the Google Calendar `events.list` request already returns the full event
  resource (including `attendees`) — no `fields`/`$select` restriction was in place — so
  no extra request parameter is needed; the gap was purely in the schema, types, and
  ingest/persistence.

**Normalized → DB**
- `packages/calendar/src/core/types.ts` — added optional `responseStatus?` to both
  `SourceEvent` and `SyncableEvent` (it flows automatically to `MaterializedSyncableEvent`
  and through the recurrence materializer, which spreads the source event).
- `packages/calendar/src/core/source/write-event-states.ts` — persist `responseStatus`
  in `buildEventStateInsertRow` and include it in the upsert conflict-set so updates
  refresh it.
- `packages/database/src/database/schema.ts` — added a nullable `responseStatus` text
  column to `event_states`.
- `packages/database/drizzle/0077_volatile_doorman.sql` — generated migration:
  `ALTER TABLE "event_states" ADD COLUMN "responseStatus" text;` (plus its meta snapshot
  + journal entry), created via `drizzle-kit generate`.

**DB → API**
- `services/api/src/queries/event-read-model.ts` — threaded `responseStatus` through
  `SyncedEventRow`, `KeeperEventProjection`, `toSyncableEvent`, `toSyncedProjection`, and
  `toKeeperEvent`.
- `services/api/src/queries/get-events-in-range.ts` and `get-event.ts` — select the new
  column and carry it into the projection (user-created events project `null`).
- `services/api/src/types.ts` — added `responseStatus: string | null` to the public
  `KeeperEvent` API type.

**Tests** — updated existing fixtures for the new required field
(`event_states` read-model rows, `KeeperEvent` fixture, and the conflict-set key
assertion).

## Compatibility / safety

- Nullable column, optional everywhere; no change to busy/free semantics or to any
  existing field.
- Only the self attendee is surfaced — no third-party attendee data is stored or exposed.
- Existing rows read back `null` until the next sync repopulates them.

## Verification

- `bun install`, `bun run build`, `bun run types` all pass (17/17 packages typecheck).
- `drizzle-kit generate` produced a well-formed single-statement migration (0077).
- Affected unit tests pass (`get-event`, `get-events-in-range`, `google-rsvp`,
  `write-event-states`); full calendar suite green (654 tests).
- Not run against a live database.

# 0008. One strict time parser for REST/MCP event writes

- Status: accepted
- Date: 2026-11-03
- Tasks: S-API-TIME (owner); depends on ADR 0002, 0003

## Context and problem statement

Finding I. REST create/update parse offset-less `startTime`/`endTime` with `new Date()` (server-local) and ignore the `timezone` field; Outlook pending invites return Graph's offset-less dateTime strings unchanged (`services/api/src/mutations/providers/outlook.ts:355-356`). Hosted production runs with TZ unset, so this is latent there, but it is live for self-hosters with TZ set and for API clients that send wall times. Suspects on the same path: a zone-only PATCH may not re-express the event (`caldav.ts:195-219`), and a title-only PATCH may wipe the stored zone (`[id].ts:58` always passes `startTimeZone`; `buildDbUpdates` writes `?? null` on key presence, `mutations/index.ts:316-318`).

## Decision drivers

1. Owner: find and confirm every discrepancy; fix at the root; fail fast, no fallbacks.
2. One choke point: both REST and MCP go only through `createEventMutation`/`updateEventMutation` (`read-models.ts:44-45`).

## Considered options

- A. Parse at the route edge.
- B. Parse at the mutation layer, which can read the stored `isAllDay`.
- C. PATCH with offset-less times and no body timezone falls back to the stored zone.

## Decision outcome

B, with a strict 400 instead of C.

### Interface contract (exact)

```ts
// services/api/src/utils/event-time-input.ts
class EventTimeInputError extends RangeError {}
const parseEventTimeInput: (
  value: string,
  timeZone: string | undefined,
  options: { isAllDay: boolean },
) => Date;
```

Grammar (anchored regex, Y-M-D validated by `Date.UTC` round-trip):
1. Datetime with `Z`/`z` or `±HH:MM` → that instant.
2. Timed `YYYY-MM-DDTHH:MM[:SS[.fff]]` → `wallTimeToInstant(wall, resolveTimeZone(timeZone))` (both from `@keeper.sh/calendar`); `EventTimeInputError` when timeZone is absent or unresolvable.
3. All-day (`isAllDay` true): date-only, or the date part of an offset-less datetime → that date at 00:00Z. An all-day value with an explicit offset keeps its stated local date only if a red test on main proves today's `toISOString().slice(0,10)` shifts it.
4. Date-only on a timed event → error.
5. A sent `timezone` that does not resolve → error, even when times carry offsets (writers later throw "Unsupported calendar timezone" and drop the copy).

`isAllDay` = `input.isAllDay` on POST; `updates.isAllDay ?? stored.isAllDay` on PATCH (`readStoredEventRange` selects `isAllDay` and `startTimeZone` on both synced and native branches). The mutation returns `{ success: false, error }`, which routes already map to 400.

Google writes of this input send a Z `dateTime` (satisfies "never an offset-less dateTime alone"); no Google behaviour change.

### Binding rules

1. Stored `startTimeZone` keeps the raw label the caller sent; resolution is for math only.
2. Zone-only PATCH: `completeUpdateRange` fills both times from stored instants when `startTimeZone !== undefined`; no CalDAV special case. Red test first.
3. Title-only PATCH zone wipe: red test first; if it reproduces, `buildDbUpdates` writes `startTimeZone` only when defined.
4. Outlook pending invites: add `Prefer: outlook.timezone="UTC"` to the calendarView request; map timed values with `parseEventDateTime` (timeZone required; an event without one is skipped) and all-day with `parseAllDayEventTime`; emit `.toISOString()`. Never use the lax no-timeZone branch of `parseEventTime`. S-API-TIME may add one export line for `parseAllDayEventTime` to `packages/calendar/src/providers/outlook/index.ts`; S-OUTLOOK-WRITE keeps `parseEventDateTime` and `parseAllDayEventTime` signatures unchanged (ADR 0009).
5. File grant: `services/api/tests/handlers/event-routes.test.ts` (route-level tests).
6. Every time-sensitive test runs under `TZ=UTC` and `TZ=America/Toronto` (the api script sets no TZ). Expected: `2026-11-05T09:00:00` + `America/Edmonton` → `2026-11-05T15:00:00.000Z` under both.
7. README gets one line under POST/PATCH `/api/v1/events` describing the `timezone` field.
8. Report the new 400s as a public API change (offset-less input without a zone; unresolvable zone). MCP inputs (zod `datetime()`, Z) are unaffected.
9. S-API-TIME keeps its own grammar; it is not merged with S-GOOGLE-STRICT's parser (different grammar: the API accepts offset-less input with a zone, Google never does).

### Consequences

- Good: one choke point; correct on any server TZ; four adjacent suspects settled with evidence.
- Bad: API break for clients relying on implicit UTC; PATCH clients must resend `timezone` with offset-less times.

## Agent context

- Research finding I; `services/api/src/utils/request-body.ts:64-90`
- `services/api/src/mutations/index.ts:287,316-318`; `services/api/src/routes/api/v1/events/[id].ts:58`
- `services/api/src/mutations/providers/outlook.ts:355-356`; `packages/calendar/src/providers/outlook/source/utils/fetch-events.ts:220` (sync already sends the Prefer header)
- Graph Prefer header: https://learn.microsoft.com/en-us/graph/api/user-list-calendarview

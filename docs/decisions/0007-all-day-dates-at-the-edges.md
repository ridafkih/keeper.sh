# 0007. All-day values stay calendar dates at every edge

- Status: accepted
- Date: 2026-11-03
- Tasks: S-FREETIME, S-MCP, S-FEED-EXDATE (owners); S-API-TIME (all-day input)

## Context and problem statement

Inside sync, all-day values are stored as UTC midnight with an exclusive end, consistently, and that must stay. Outside sync they are re-projected as instants:

- E: API `find-free-time` (and MCP free-time, which calls it) treats them as UTC-midnight spans (`services/api/src/queries/find-free-time.ts:48-59`), so every non-UTC user gets wrong busy/free hours, and in narrow windows the event is dropped by the UTC overlap filter.
- F: MCP `get_events` strips `isAllDay` in zod (`services/mcp/src/toolset.ts:3-15`) and converts the bounds to the viewer zone (`:218-222`), so west of UTC an all-day Nov 5 event shows as `2026-11-04T18:00:00-06:00`.
- The outbound ICS feed emits a DATE-TIME EXDATE under a DATE DTSTART for an excluded override of an all-day master (`services/api/src/utils/ical-format.ts:48-53,175,196,258`), violating RFC 5545 §3.8.5.1.

## Decision drivers

1. Owner: discrepancies that put events at the wrong time or drop them, for every user outside UTC.
2. Keep the sync core's convention; fix only the projections.
3. Fail fast; no silent UTC default.

## Decision outcome

One convention: **an all-day value is the calendar date at 00:00Z, end exclusive (RFC 5545, Google)**. Each edge maps it explicitly.

### Interface contracts (exact)

S-FREETIME (`services/api`):
```ts
// utils/free-time.ts
const resolveRequestTimeZone: (identifier: string) => string; // wraps resolveTimeZone from @keeper.sh/calendar; throws FreeTimeValidationError("timezone must be an IANA timezone identifier")
// queries/find-free-time.ts
const ALL_DAY_ZONE_PROJECTION_SLACK_MS: number; // = MS_PER_DAY
const projectAllDaySpanToZone: (span: { start: Date; end: Date }, timeZone: string) => { start: Date; end: Date };
const toBusyInterval: (candidate, range, timeZone: string) => BusyInterval | null; // timeZone required, no default
const toBusyIntervals: (candidates, range, timeZone: string, ignoreAllDayEvents: boolean) => BusyInterval[];
```
`findFreeTime` and `isBlocking` keep their names. The zone is resolved once before any DB query and passed to both busy collection and slot finding.

S-MCP (`services/mcp/src/toolset.ts`): `keeperEventSchema` gains `isAllDay: z.boolean()` (required). In `get_events`, all-day events return `startTime: "YYYY-MM-DD"` and `endTime: "YYYY-MM-DD"` (exclusive) via `new Date(iso).toISOString().slice(0, 10)`, plus `isAllDay: true`. Timed events unchanged through `toLocalizedTime`. `get_event`, `create_event`, `update_event` keep returning UTC instants (plus `isAllDay`), because `update_event` input requires `z.string().datetime()`.

S-FEED-EXDATE (`services/api/src/utils/ical-format.ts`): internal `buildExceptionDate(value, timezone, isAllDay)`; `buildMasterIcsEvent` receives the `masterIsAllDay` already computed at `:196`. When the master is all-day, every EXDATE is `{ date, type: "DATE" }`. Timed output byte-identical. No exported signature changes.

### Binding rules

1. Free-time projection uses C1's IANA `wallTimeToInstant(wallTime, timeZone)`: from local midnight of the first day to local midnight after the last. DST days come out 23 h / 25 h; a midnight gap starts at the first existing instant.
2. Free-time widens only the in-memory filters (`materializeSyncedEvents` overlap and `isWithinReadWindow`) by `ALL_DAY_ZONE_PROJECTION_SLACK_MS`; SQL range conditions stay on the real range (`toScanBounds` already adds a day, `get-events-in-range.ts:95-98`). The final clip to the true range does the exact cut.
3. S-FREETIME may edit `services/api/tests/queries/degenerate-range-busy-interval.test.ts` (the only other `toBusyInterval` caller) to pass `"UTC"`.
4. S-MCP does a read-only check that every API producer emits a boolean `isAllDay` before making it required; if one doesn't, stop and report rather than infer.
5. S-MCP does not add a neighbour-day filter. The instant-based range query that includes its end (`get-events-in-range.ts:114-154`) returning the adjacent UTC day's all-day events is a **candidate finding** INTEGRATE must probe and report; it is not fixed in this run unless confirmed and assigned.
6. S-FEED-EXDATE first checks how ts-ics writes a DATE exception list and pins the real line; each case asserts both the line and an ical.js expansion; also run under `TZ=America/Edmonton`. Report as an RFC conformance fix; Google/Apple client impact unverified.
7. S-API-TIME: all-day REST input (date-only, or the date part of an offset-less datetime) becomes that date at 00:00Z; date-only on a timed event is a 400 (ADR 0008).
8. Expected values in tests are literal UTC ISO strings; DST fixture dates checked against vendored 2026f ICU before writing.
9. `projectAllDaySpanToZone` stays in `services/api`; MCP needs no instant projection because it emits dates.

### Consequences

- Good: free-time correct for all non-UTC users; MCP all-day events on their date; feed conformant.
- Bad: API/MCP output shapes change for all-day events (intended); `get_events` and `get_event` differ in all-day shape; reach of E/F not countable from logs (report as "every non-UTC caller with all-day events").

## Agent context

- Research §2 item 4, findings E and F, feed item 89
- `services/api/src/queries/find-free-time.ts:48-59`; `services/api/src/queries/get-events-in-range.ts:95-98,114-154`
- `services/mcp/src/toolset.ts:3-15,218-222,337-338,366-367`
- `services/api/src/utils/ical-format.ts:48-53,175,196,258`
- RFC 5545 §3.8.5.1: https://www.rfc-editor.org/rfc/rfc5545#section-3.8.5.1

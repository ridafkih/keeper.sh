# 0005. CalDAV collection time zone governs floating times

- Status: accepted
- Date: 2026-11-03
- Tasks: S-CALDAV-ZONE (owner); depends on ADR 0003; uses S-RECUR's `applyCalendarTimeZoneToFloatingEventDates`

## Context and problem statement

Finding A, the one with measured reach: 11 users / 12 calendars / 102 failed runs in 24 h, 15 users in 7 d. Timed floating DATE-TIME events from iCloud, Fastmail and generic CalDAV are rejected, because the collection's `CALDAV:calendar-timezone` (RFC 4791 §5.2.2) / `calendar-timezone-id` (RFC 7809) is fetched by tsdav and then thrown away.

## Decision drivers

1. Owner: discrepancies that drop users' events; fix at the root.
2. Never guess UTC or the server zone when no collection zone is known.
3. iCloud throttles; avoid extra requests.

## Considered options

- A. A second Keeper-issued Depth:1 PROPFIND for the two props (the handed acceptance criterion).
- B. Ask for the props inside the discovery PROPFIND tsdav already sends, via `fetchCalendars({ props, projectedProps })`, which returns raw props with CDATA kept (tsdav 2.1.8, `dist/tsdav.cjs:910-970`).

## Decision outcome

B. A is a workaround built on a wrong premise (only tsdav's own `timezone` field drops CDATA). B costs zero extra requests, attaches each zone to its calendar, adds no error-policy surface and doesn't ripple into ~12 test mocks.

### Interface contract (exact)

```ts
// packages/calendar/src/providers/caldav/types.ts
interface CalendarInfo { /* existing fields */ timeZone?: string } // resolved IANA name only

// packages/calendar/src/providers/caldav/shared/collection-timezone.ts (new)
type CollectionPropValue = string | { _cdata: string } | { _text: string };
const resolveCollectionTimeZone: (projectedProps: Record<string, unknown> | undefined) => string | undefined;

// packages/calendar/src/providers/caldav/shared/client.ts
resolveCalendar(storedUrl: string): Promise<{ url: string; timeZone?: string }>; // no match => { url: storedUrl }
// resolveCalendarUrl delegates to resolveCalendar and keeps its signature.

// packages/calendar/src/providers/caldav/shared/ics.ts
interface ParseICalCalendarsOptions { /* existing */ calendarTimeZone?: string }
```

Precedence for floating times in a resource: the resource's own `X-WR-TIMEZONE` (through `normalizeTimezone`), then `calendarTimeZone`, then nothing (rejected exactly as on main). The chosen zone is passed unchanged to `applyCalendarTimeZoneToFloatingEventDates(ical, zone)`, whose exported signature is fixed (ADR 0006).

Collection zone precedence inside `resolveCollectionTimeZone`: `calendar-timezone-id` via `resolveTimeZoneIdentifier`; else the TZID of the single VTIMEZONE in `calendar-timezone`, resolved with `readDeclaredTimeZoneOffsets` of that VCALENDAR; else `undefined`. A non-IANA DST collection zone resolves to `undefined`.

### Binding rules

1. Discovery `props` = tsdav 2.1.8's eight defaults (calendar-description, calendar-timezone, displayname, calendar-color, getctag, resourcetype, supported-calendar-component-set, sync-token) plus `c:calendar-timezone-id`; `projectedProps = { calendarTimezone: true, calendarTimezoneId: true }`. A test pins every default prop name in the request body.
2. Request count stays one PROPFIND per discovery walk, zero on a cache hit (tested).
3. `isCalendarInfo` (discovery cache) accepts entries without `timeZone` or with a string, rejects any other type. Cache key unchanged; old entries heal within 900 s.
4. A transport or auth failure caches nothing; a 404 propstat means no zone and no error.
5. Tests drive real tsdav with an injected fetch (the fake-server pattern of `client-cross-origin-calendar-href.test.ts`) for CDATA, entity-encoded, `_text`, `-id` only, and neither. New pure tests go in `tests/providers/caldav/shared/collection-timezone.test.ts`; S-CALDAV-ZONE does not edit `ics-timezone-resolution.test.ts` (S-ENGINE edits it, ADR 0004). Fixtures use only Europe/Berlin and Asia/Manila (stable rules), never Edmonton.
6. File grants: new `collection-timezone.ts` and `collection-timezone.test.ts`. No `packages/calendar/src/ics/utils/*` edits.
7. Run the whole calendar package suite (core/sync-engine tests mock tsdav).
8. Report: iCloud's real property shape is unverified (no test account); finding A is called fixed for iCloud only after post-deploy Loki shows the floating-reject count dropping from the baseline.

### Consequences

- Good: dropped floating events from CalDAV collections with a declared zone ingest at the correct instant.
- Bad: coupled to tsdav's default prop list (pinned by test); non-IANA DST collection zones stay rejected.

## Agent context

- Research finding A and reach (G5, Q8)
- `node_modules/tsdav/dist/tsdav.cjs:910-970`
- `packages/calendar/src/providers/caldav/shared/client.ts:253-274`
- RFC 4791 §5.2.2: https://www.rfc-editor.org/rfc/rfc4791#section-5.2.2; RFC 7809: https://datatracker.ietf.org/doc/rfc7809

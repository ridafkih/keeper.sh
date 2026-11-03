# 0009. Provider writers write instants; provider parsers never read server-local time

- Status: accepted
- Date: 2026-11-03
- Tasks: S-OUTLOOK-WRITE, S-GOOGLE-STRICT (owners)

## Context and problem statement

- K (Outlook destination): `serializeOutlookEvent` computes a wall time in the resolved IANA zone, labels it with the raw stored name and throws "Unsupported calendar timezone" for non-IANA labels; the per-event catch in `outlook/destination/provider.ts:228-265` turns that into a failed push on every sync (dropped copy). Recurring events with such labels are withheld at ingest, so only one-off timed events can reach the writer.
- `outlook/shared/date-time.ts` `parseEventTime` and `google/shared/date-time.ts` fall back to `new Date(value)` for offset-less values (server-local).
- `outlook/destination/serialize-recurrence.ts` is imported but can never yield a value: `MaterializedSyncableEvent.recurrenceRule?: never` (`core/types.ts:78`).
- Google's `buildDateField` only sends `timeZone` (with a `"UTC"` default) when `recurrenceRule` is passed, and no caller passes it (`google/destination/serialize-event.ts:8-22`).

## Decision drivers

1. Owner: fix discrepancies that drop copies or misplace them; remove dependence on others' stale tzdata (same class as #1093).
2. Fail fast; never read server-local time.
3. Don't inflate the audit: hardening is not a finding.

## Considered options

- Outlook: A. single UTC rule `{ dateTime: <UTC wall>, timeZone: "UTC" }` for every timed copy; B. map IANA to Windows ids with a UTC fallback (X4); C. catch and fall back.
- Parsers: throw `RangeError` vs return null vs resolve with zone.

## Decision outcome

Outlook A (C treats the symptom; B is the owner's call, reported as X4). Parsers throw `RangeError`.

### Interface contracts (exact)

```ts
// packages/calendar/src/providers/outlook/destination/serialize-event.ts
serializeOutlookEvent(event: MaterializedSyncableEvent): OutlookEvent; // timed start/end: { dateTime: <ISO without Z, UTC>, timeZone: "UTC" }

// packages/calendar/src/providers/outlook/shared/date-time.ts — names and signatures unchanged
parseEventDateTime(eventTime: OutlookDateTime): Date;
parseAllDayEventTime(time: PartialOutlookDateTime | undefined): Date | null;
parseEventTime(...): Date | null; // no-timeZone branch: parses only Z/±hh:mm, else throws RangeError("Outlook dateTime has no offset or timezone: <value>")

// packages/calendar/src/providers/google/shared/date-time.ts — names unchanged
parseEventDateTime(eventTime: PartialGoogleDateTime): Date;  // throws RangeError on malformed, offset-less or impossible values
parseEventTime(time: PartialGoogleDateTime | undefined): Date | null; // null only when no time is present

// packages/calendar/src/providers/google/destination/serialize-event.ts
serializeGoogleEvent(event: MaterializedSyncableEvent, uid: string): GoogleEvent | null; // third parameter removed
```

Note: the handed name `parseGoogleDateTime` does not exist; the existing exports carry the strict behaviour through a private helper.

### Binding rules

1. K is confirmed only for labels that pass a provenance test: a one-off VEVENT through the real ICS fetch adapter, UID not in `unsupportedEventUids`, stored raw label, then `serializeOutlookEvent` throws on main. Labels: `Customized Time Zone`, `(UTC-07:00) Mountain Time (US & Canada)`, `(UTC+08:00) Kuala Lumpur, Singapore`, `/mozilla.org/20050126_1/America/Denver`, plus `US/Eastern`, `Asia/Calcutta`, `Eastern Standard Time`, `America/Edmonton`, undefined as guards. Links and Windows names are a **removed risk**, not confirmed. Red proof is taken on origin/main, because ADR 0003/0004 change what ingest stores.
2. `serialize-recurrence.ts` and its test are deleted by S-OUTLOOK-WRITE (the effect is unreachable; S-GOOGLE-STRICT's note that it is "live" refers only to its import). If knip then flags `OutlookEvent.recurrence` in data-schemas, INTEGRATE reports it.
3. The strict Outlook parse lands in its own commit. Before landing, check callers (`outlook/destination/provider.ts:95-96,116-117`, `source/utils/fetch-events.ts:591-592`). Graph always returns `timeZone` with `dateTime`, so the throw is reached only on a contract break; if a caller would abort a whole list on one item, hold the commit and report rather than edit `provider.ts`.
4. Google: before shipping the throw, confirm from the Google Calendar v3 Events reference that response `dateTime` always carries an offset; if not, stop and report. Pattern accepts `T`/`t`, `Z`/`z`, fractional seconds; dates validated by `Date.UTC` round-trip (Bun rolls `2026-02-30` into March). Per-event isolation in `google/source/utils/fetch-events.ts` is out of scope; default is a loud whole-fetch failure on a contract break, stated in the report.
5. Google tests run in two separate processes, `TZ=UTC` and `TZ=America/Edmonton`. Only offset-less, malformed and impossible-date cases count as red; Z/offset cases and the serializer guard are regression/characterization tests.
6. Verification covers the full `packages/calendar` suite and `packages/sync/tests/destination-backoff-convergence.test.ts` (imports `serializeGoogleEvent`).
7. Report labels: Outlook K (if confirmed) is a finding; strict parsers, dead-code removals and the Google branch removal are hardening. Outlook copies display UTC as the event zone (cosmetic); X4 is the owner's call.
8. No recurring-series write path is designed for Google or Outlook in this run; S-ENGINE and S-RECUR must not start passing a recurrence to either serializer.

### Consequences

- Good: no Outlook copy dropped for a resolvable instant; writer independent of Exchange tzdata; no server-local reads in provider parsers.
- Bad: Outlook shows UTC as the zone label; a provider contract break now fails loudly.

## Agent context

- Research finding K, R1, X4; G7 (Outlook seconds churn is out of class)
- `packages/calendar/src/providers/outlook/destination/serialize-event.ts:11,75-90`; `provider.ts:95-96,116-117,228-265`
- `packages/calendar/src/core/types.ts:59,73,78`
- `packages/calendar/src/providers/google/destination/serialize-event.ts:8-40`; `google/source/utils/fetch-events.ts:365`
- Google Events resource: https://developers.google.com/workspace/calendar/api/v3/reference/events
- Graph dateTimeTimeZone: https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone

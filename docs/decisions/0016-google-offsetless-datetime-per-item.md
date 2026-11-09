# 0016. An offset-less Google dateTime is read in its timeZone and fails only its own item

- Status: accepted
- Date: 2026-11-03
- Supersedes: the Google `parseEventDateTime` and `parseEventTime` contracts in 0009 and the whole-fetch default in 0009 rule 4
- Tasks: S-GOOGLE-STRICT (owner); recorded by INTEGRATE attempt 2

## Context and problem statement

0009 made the Google parsers throw `RangeError` on offset-less values and accepted a loud whole-fetch failure on a contract break. 0009 rule 4 also said to stop if Google's reference allows an offset-less response `dateTime`. It does: the Events resource says of `dateTime`: "A time zone offset is required unless a time zone is explicitly specified in timeZone". `parseEventTime` runs inside the list loops of `google/source/utils/fetch-events.ts` and `google/destination/provider.ts` with no catch, so one such item failed the whole source fetch and dropped every event in that calendar.

## Decision outcome

### Interface contracts (exact)

```ts
// packages/calendar/src/providers/google/shared/date-time.ts — names unchanged
parseEventTime(time?: PartialGoogleDateTime): Date | null;
// dateTime with Z/±hh:mm: that instant
// dateTime without an offset and a timeZone resolveTimeZone accepts: wallTimeToInstant in that zone
// dateTime without an offset and no resolvable timeZone, or a malformed or impossible value: null
// date: that calendar date at UTC midnight, or null when impossible
parseEventDateTime(eventTime: PartialGoogleDateTime): Date; // throws RangeError naming the value where parseEventTime returns null
```

### Binding rules

1. `parseEventTime` never throws. A `null` start or end makes `parseGoogleEventsWithDiagnostics` count that item in `unrepresentableCount` and skip it; the fetch continues.
2. The pattern still accepts `T`/`t`, `Z`/`z` and fractional seconds, and dates are still validated by a `Date.UTC` round-trip.
3. Nothing reads server-local time; the rest of 0009 is unchanged.

### Consequences

- Good: an offset-less value Google documents as valid lands at the right instant, and one off-contract item no longer drops the calendar.
- Bad: an item with no resolvable zone is skipped quietly and shows only in the unrepresentable count.

## Agent context

- Google Events resource: https://developers.google.com/workspace/calendar/api/v3/reference/events
- `packages/calendar/src/providers/google/shared/date-time.ts`; `google/source/utils/fetch-events.ts:365-368`; `google/destination/provider.ts:79-82`

# 0004. Declared VTIMEZONE engine: IANA wins, ical.js change lists otherwise

- Status: accepted
- Date: 2026-11-03
- Tasks: S-ENGINE (owner); depends on ADR 0002 and 0003; consumers S-RECUR, S-CALDAV-ZONE, S-OUTLOOK-WRITE

## Context and problem statement

ts-ics 2.4.3 (and 2.4.8) misprojects every VTIMEZONE Keeper.sh hands it: RRULE onsets apply from local midnight, one-shot onsets are read against `TZOFFSETTO`, RDATE lists read as one value (ts-ics #224). This puts events an hour off near transitions (B1: Keeper.sh's own one-shot VTIMEZONEs read back from CalDAV destinations, which also causes replace churn; B2: Mozilla/Thunderbird and Exchange custom zones), and an undeclared, unrecognised TZID falls back to the server's local zone (C). The comment at `resolve-zoned-instants.ts:30-34` claiming ts-ics reads one-shot sets correctly is false.

## Decision drivers

1. Owner: "full audit of similar time zone discrepancies"; this is the same class as today's Manila RDATE bug. Fix the root (offset math in ts-ics) once, never per zone.
2. Owner rule: never fall back, fail fast. A guessed server-local time is worse than a withheld event.
3. G1 probe: ical.js 2.2.1 `changes` + Keeper's gap/fold rule scored 12/12, 12/12, 12/12, 15/15, 24/24, 4/4 on the hard samples; ts-ics and ical.js `utcOffset` did not.

## Considered options

- A. Upgrade or patch ts-ics.
- B. Write a custom VTIMEZONE projector.
- C. Use ical.js `Timezone.changes` as the offset source, fed through `wallTimeToInstantWith`; IANA rules win when the TZID resolves.

## Decision outcome

C.

### Interface contract (exact)

```ts
// packages/calendar/src/ics/utils/declared-timezone-offsets.ts
const declaredZoneOffsetAt: (vtimezoneText: string) => ZoneOffsetAt | undefined;

// packages/calendar/src/ics/utils/extract-vtimezones.ts (new)
const extractVtimezones: (icsString: string) => {
  icsString: string;
  blocksByTimeZoneId: ReadonlyMap<string, string>;
};

// packages/calendar/src/ics/utils/resolve-zoned-instants.ts
resolveCalendarZonedInstants(calendar, blocksByTimeZoneId: ReadonlyMap<string, string>) // gains a required argument; only caller is parse-ics-calendar.ts

// parseIcsCalendar keeps its exported signature and return type.
```

- `declaredZoneOffsetAt` returns `undefined` for a block that will not parse or has no usable observance (deliberate deviation from the handed `: ZoneOffsetAt`; undefined falls through to unsupported).
- `blocksByTimeZoneId` keys are normalised through `resolveTimeZoneIdentifier`-compatible normalisation on both sides (event `TZID` param and VTIMEZONE `TZID`); first definition wins on duplicates.

### Binding rules

1. Decision per TZID-qualified DTSTART, DTEND, EXDATE, RECURRENCE-ID and RRULE UNTIL:
   1. If `resolveTimeZoneIdentifier(tzid, declaredOffsets)` resolves, IANA rules decide via `wallTimeToInstantWith(wall, ianaOffsetAt(zone))`, even when the declared VTIMEZONE disagrees (policy change; flips the #1094 "explicit observance set authoritative" test; must be named in the report).
   2. Else if the calendar declares a VTIMEZONE for it, `declaredZoneOffsetAt(block)` feeds `wallTimeToInstantWith`.
   3. Else the event is withheld as unsupported. Never server-local.
2. ical.js `utcOffset` is never used. ical.js internals (`changes`, `_ensureCoverage`) are wrapped in one typed adapter inside `declared-timezone-offsets.ts`. One `ICAL.Timezone` per TZID per parse; `_ensureCoverage` once on the widest year needed plus one; sorted epoch array built once; binary search for the last change at or before the instant, `prevUtcOffset` of the first change before it. A later year means a fresh instance (re-expansion appends duplicates, `timezone.js:395-407`). Offsets are `utcOffset seconds / 60`, never rounded (ADR 0002).
3. If the Manila RDATE-only corpus case shows ical.js dropping the DTSTART onset (`timezone.js:451-480`), normalise by adding the DTSTART onset as an RDATE before parsing; otherwise don't.
4. `packages/calendar/package.json` pins `"ical.js": "2.2.1"` exactly.
5. ts-ics stays as the parser only: `extractVtimezones` removes every VTIMEZONE block before ts-ics sees the text. Values are re-derived from ts-ics `local.date`. A TZID-qualified start/end that ts-ics returned with no `local` (unquoted label) makes the event unsupported.
6. `detach-projected-vtimezones.ts` and `synthesize-vtimezones.ts` are deleted (and the false comment with them). `calendar.timezones` is no longer populated (grep first; nothing reads it).
7. Unsupported signal is **per event** (typed marker on the event-level nonStandard generic, not `CalendarNonStandardValues`), merged in `parse-ics-events.ts` via `mergeUnsupportedEvents` with reason `Unsupported calendar timezone: <tzid>`. It must be per event because CalDAV merges resources as `{ ...firstCalendar, events }` (`caldav/shared/ics.ts:214-217`), which drops calendar-level fields. A withheld event keeps its stored state and is not diffed as a deletion.
8. File grants beyond the handed list: S-ENGINE owns `packages/calendar/src/ics/utils/parse-ics-events.ts` (no other slice edits it) and `extract-vtimezones.ts`. S-ENGINE may edit only the `detachProjectedVtimezones` cases in `packages/calendar/tests/providers/caldav/shared/ics-timezone-resolution.test.ts` (move them to `extractVtimezones`/`parseIcsCalendar` assertions); S-CALDAV-ZONE adds no tests to that file (ADR 0005).
9. Kuala Lumpur label with no VTIMEZONE: unsupported (ADR 0003 rule 2), under `TZ=UTC` and `TZ=America/Edmonton`. Every corpus case asserts "never a server-local instant".
10. Known remaining gap: a recurring series in a declared non-IANA DST zone is re-projected by zone name in `recurrence-materializer.ts`, so it stays withheld through `collectUnsupportedRecurrenceTimeZones`. A test asserts it is withheld; the report names it as a confirmed gap, not fixed.
11. Tests: round-trip sweep through Keeper.sh's own writer and reader over every hour of every 2024-2028 transition day (named high-risk zones always; stride sample by default; every zone with `CALENDAR_TZ_SWEEP_EXHAUSTIVE=1`); declared-engine sweep renaming each `buildVtimezone` block to an unresolvable TZID and comparing with Intl; ICU-generated historic years (Manila 1945, Moscow 2011/2014, Apia 2011, Almaty 2024, Mexico City 2022, Nuuk 2023, Asuncion 2024) under both a non-IANA and an IANA TZID; the hand-written provider corpus in `tests/ics/fixtures/declared-timezones/` (under 1 MB) including a two-resource CalDAV case with the unresolved zone in the second resource.
12. Exports: `declaredZoneOffsetAt` is exported from its module for reuse; no shared seam module is added.

### Consequences

- Good: B1, B2 and C closed at one root; CalDAV destination churn stops because the destination re-reads copies through the same path.
- Bad: depends on undocumented ical.js internals (pinned, one adapter, sweeps); IANA-wins changes behaviour for senders who ship custom rules under real IANA names; declared DST recurring series stay withheld.

## Agent context

- Research §2 items 2 and the engine table: the audit research notes (kept outside the repository)
- `packages/calendar/src/ics/utils/resolve-zoned-instants.ts:30-34,66`; `detach-projected-vtimezones.ts:46`; `parse-ics-events.ts:463,533`
- `packages/calendar/src/providers/caldav/shared/ics.ts:214-217`
- `services/api/node_modules/ical.js/lib/ical/timezone.js:354,395-407,451-480`
- ts-ics issue #224: https://github.com/Neuvernetzung/ts-ics/issues/224; changelog: https://github.com/Neuvernetzung/ts-ics/blob/master/packages/ts-ics/CHANGELOG.md
- RFC 5545 §3.6.5: https://www.rfc-editor.org/rfc/rfc5545#section-3.6.5; §3.2.19: https://datatracker.ietf.org/doc/html/rfc5545#section-3.2.19
- Prior PRs: `git show 8a585aa6` (#1093), `git show ab4ee659` (#1094)

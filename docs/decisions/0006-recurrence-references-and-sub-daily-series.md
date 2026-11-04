# 0006. Recurrence references resolve against the series master; one occurrence per instant

- Status: accepted
- Date: 2026-11-03
- Tasks: S-RECUR (owner); depends on ADR 0002, 0003, 0004; consumers S-CALDAV-ZONE, S-FEED-EXDATE

## Context and problem statement

Finding J. Probes on origin/main show the same-zone floating EXDATE, RECURRENCE-ID and UNTIL cases already resolve correctly (fixed in #606, pinned at `fetch-adapter.test.ts:431-540`). What is still broken:

- DATE EXDATE (VALUE=DATE or bare 8-digit) and DATE UNTIL on a timed series are compared as UTC midnight, not the series' local day (ghost occurrence, lost last day).
- DATE RECURRENCE-ID, and a floating RECURRENCE-ID on an override whose own DTSTART is in another zone or in UTC, resolve in the override's zone (`readEventTimeZoneContext` per block, `fetch-adapter.ts:241`), giving a duplicate, or a withhold when there is no X-WR-TIMEZONE.
- FREQ=HOURLY across a spring-forward gap yields two occurrences on one instant, and the fall-back hour is skipped; Apia 2011 DAILY yields a duplicate.

## Decision drivers

1. Owner: discrepancies that duplicate or drop events, each confirmed; fix at the root.
2. Don't overstate: cases already fixed are regression pins, not findings.
3. Don't trade a ghost for a dropped series.

## Considered options

- A. Carry a DATE/floating flag through `SyncableEvent`, stored recurrence and content hash.
- B. Normalise at ingest, against the series master, in a new pure module; fix sub-daily stepping in the materializer.
- C. Dedupe only.

## Decision outcome

B. Stored data becomes correct for every reader (materializer, outbound feed, free-time, get-events) without schema changes in files other tasks own. C leaves the fold-hour skip.

### Interface contract

- `applyCalendarTimeZoneToFloatingEventDates(ical, calendarTimeZone)` in `packages/calendar/src/ics/utils/fetch-adapter.ts` keeps its exported signature exactly (S-CALDAV-ZONE calls it).
- `materializeMaster` emits at most one occurrence per instant; dedupe runs after the excluded and overridden checks, so the first surviving copy wins deterministically.
- New pure module `packages/calendar/src/ics/utils/series-recurrence-references.ts` (granted to S-RECUR), wired from `normalizeFloatingEventDates`.

### Binding rules

1. First pass builds UID → master context from the VEVENT with an RRULE and no RECURRENCE-ID: declared TZID (or calendarTimeZone, or Z), DTSTART wall time of day, all-day flag, FREQ/INTERVAL/BYHOUR/BYMINUTE/BYSECOND.
2. Floating or DATE RECURRENCE-ID → `RECURRENCE-ID;TZID=<master zone>:<date>T<time>` (master time of day for DATE; own wall time for floating). An orphan override with no master keeps today's behaviour.
3. DATE EXDATE on a timed master expands to every wall time the rule yields that local day (BYHOUR × BYMINUTE × BYSECOND, each defaulting to DTSTART's). Selector-free HOURLY emits every interval-aligned hour instant in the local-day bounds as Z values (covers both fold hours). MINUTELY/SECONDLY fall back to the master's time of day; never throw or withhold. `isAbsoluteDateEntry` stops treating bare dates as absolute on timed series.
4. DATE UNTIL on a timed master → UTC instant of the next local midnight minus one second.
5. All zone math goes through the existing `zones.resolved` path as replaced by ADR 0003/0004 (C2 resolver + C1 `wallTimeToInstant`). No second resolver. An unresolvable zone keeps the existing RangeError → withheld path.
6. All-day masters are untouched.
7. Materializer: split `resolveExpansionTimeZone` into `{ seriesTimeZone, expansionTimeZone }`. `expansionTimeZone` is undefined for all-day series (as today) and for HOURLY/MINUTELY/SECONDLY rules with no occurrence selectors, which then step in elapsed time. `seriesTimeZone` still drives nominal durations (`addIcsDuration`).
8. Gap rule stays shift-forward for every other rule. The RFC 5545 §3.3.10 "ignore" alternative is an owner decision in the report (X1), not code.
9. Declared non-IANA DST series stay withheld (ADR 0004 rule 10); S-RECUR does not add a declared offset source to the materializer.
10. Tests run end to end (ICS text → `createIcsSourceFetcher` → `materializeRecurrenceEvents`) asserting destination-visible instants and synthetic ids, west (America/Los_Angeles 17:00) and east (Asia/Tokyo 10:00 and 17:00, never 09:00) of UTC, plus the CalDAV entry point. Same-zone floating cases are labelled "already passing on main". The existing degenerate-series DST tests stay unchanged; add a DAILY 02:30 spring-forward shift-forward pin.
11. Re-probe after C1/C2/S-ENGINE land and drop cases they already fixed. Never stage the stray `tests/zz-probe-srecur.test.ts`.

### Consequences

- Good: ghost, duplicate and lost-day outcomes fixed for new ingest; the outbound feed stops emitting DATE EXDATEs under timed masters for these series (closes S-FEED-EXDATE's reverse case for re-ingested data).
- Bad: corrected stored values flip content hashes (one round of updates at destinations); an unchanged feed may skip re-ingest via the snapshot hash, so INTEGRATE must check whether existing users get the fix without a forced re-ingest. Residuals reported: filtered sub-daily fold skip; MINUTELY/SECONDLY DATE EXDATE excludes one slot; possible all-day DATE-TIME mirror case untested.

## Agent context

- Research finding J and §2 item 5
- `packages/calendar/src/ics/utils/fetch-adapter.ts:209,241,302,396-404,432`
- `packages/calendar/src/core/events/recurrence-materializer.ts`
- `packages/calendar/tests/ics/utils/fetch-adapter.test.ts:431-540`
- RFC 5545 §3.3.10: https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10; §3.8.5.1: https://www.rfc-editor.org/rfc/rfc5545#section-3.8.5.1

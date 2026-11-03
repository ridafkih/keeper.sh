# 0002. Wall-time resolution over any offset source

- Status: accepted
- Date: 2026-11-03
- Tasks: C1 (owner); consumers S-ENGINE, S-FREETIME, S-API-TIME, S-RECUR

## Context and problem statement

`wallTimeToInstant(wallTime, timeZone)` in `packages/calendar/src/ics/utils/timezone-instant.ts` holds Keeper.sh's RFC 5545 §3.3.5 rule (a wall time in a gap shifts forward by the transition size, a wall time in a fold takes the earlier instant), but only for IANA zones read through `Intl`. Declared non-IANA VTIMEZONEs (findings B1, B2, C, Manila RDATE) are resolved by ts-ics instead, which gets gaps and folds wrong, and ical.js `utcOffset` gets them wrong in the opposite direction. The rule must live in one place and work for any zone definition.

## Decision drivers

1. Owner: "full audit of similar time zone discrepancies that might cause issues for users"; fix at the root, not per zone.
2. No behaviour change for existing IANA callers (recurrence materializer, build-vtimezone, build-zoned-date, Outlook date-time, API free-time).
3. Parallel slices code against the contract at the same time, so the unit must be unambiguous.
4. Some offsets carry seconds (Africa/Monrovia -00:44:30, Europe/Amsterdam LMT +00:19:32) and are pinned by `wall-time-zone-sweep-whole-minute-offsets.test.ts`.

## Considered options

- A. `ZoneOffsetAt` returns minutes east of UTC, fractional allowed, never rounded.
- B. `ZoneOffsetAt` returns milliseconds.
- C. Keep two code paths (Intl for IANA, ical.js `utcOffset` for declared zones).

## Decision outcome

A. B is purer but slices already code to minutes, and a silent 60000x unit mismatch between two plain numbers would cause worse wrong-time bugs than it prevents. C contradicts RFC 5545 §3.3.5.

### Interface contract (exact)

```ts
type ZoneOffsetAt = (instant: Date) => number;
const ianaOffsetAt: (timeZone: string) => ZoneOffsetAt;
const wallTimeToInstantWith: (wallTime: Date, offsetAt: ZoneOffsetAt) => Date;
const wallTimeToInstant: (wallTime: Date, timeZone: string) => Date;
```

- `wallTime` is a `Date` whose UTC fields hold the local wall-clock fields (the existing convention).
- `ZoneOffsetAt` returns minutes east of UTC at that instant. Fractional values are allowed and must never be rounded by a provider.
- `ianaOffsetAt(timeZone)` = `(instant) => getTimeZoneOffsetMilliseconds(instant, timeZone) / 60_000` (one source of truth, reuses the cached formatter).
- `wallTimeToInstantWith` converts each probe once with `Math.round(offsetAt(x) * 60_000)` and compares in integer milliseconds. Algorithm moved verbatim from today: probe one day before and one day after, keep the candidates that round-trip, take the earlier on a fold, shift forward by the pre-transition offset on a gap, otherwise throw `RangeError("Unable to resolve wall time <ISO>")`.
- `wallTimeToInstant` delegates to `wallTimeToInstantWith(wallTime, ianaOffsetAt(timeZone))`, catches only `RangeError` from the core and rethrows `RangeError("Unable to resolve wall time in timezone <tz>", { cause })`.
- Exports added to the module export list: `ZoneOffsetAt` (type), `ianaOffsetAt`, `wallTimeToInstantWith`. Every existing export (`findTimeZoneTransitions`, `formatIcsUtcOffset`, `getTimeZoneOffsetMinutes`, `instantToWallTime`, `isSupportedTimeZone`, `resolveTimeZone`, `TimeZoneTransition`, `wallTimeToInstant`) keeps its name and signature.
- `packages/calendar/src/index.ts` is not edited by C1; in-package consumers import from the module file.

### Binding rules

1. Any `ZoneOffsetAt` built from ical.js uses `utcOffset seconds / 60` from its `changes` list. Never build a source from `getTimeZoneOffsetMinutes`, `formatIcsUtcOffset` or any integer-minute helper.
2. Consumers rely on the `RangeError` type, never on the message text.
3. The ±1-day two-probe premise now applies to declared zones. A declared VTIMEZONE with two transitions within 24 hours may throw; S-ENGINE treats that as unsupported, never guesses.
4. `findTimeZoneTransitions`, `findTransitionInstant` and `getTimeZoneOffsetMinutes` stay IANA-only and unchanged.
5. C1 does not touch `isSupportedTimeZone` or `normalize-timezone.ts` (C2 owns resolution; see ADR 0003).
6. Tests: synthetic step-function sources for gap, fold, steady, sub-minute (-44.5 and 19 + 32/60) and an inconsistent source that must throw; IANA parity every 15 minutes on the 2026 Denver and Edmonton transition days, Lord_Howe's 30-minute shift, Amsterdam 1920 and Monrovia 1960. All existing `wall-time-*` sweeps pass unchanged.

### Consequences

- Good: one gap/fold rule for IANA and declared zones; IANA output bit-identical.
- Bad: fractional minutes is a unit that sounds whole; mitigated by an unrounded IANA source, a sub-minute test and rule 1.

## Agent context

- `packages/calendar/src/ics/utils/timezone-instant.ts:124` (already millisecond-based), `:196-226` (current `wallTimeToInstant`)
- `packages/calendar/tests/ics/utils/wall-time-zone-sweep-whole-minute-offsets.test.ts`
- `knip.json` `ignoreExportsUsedInFile: true`
- RFC 5545 §3.3.5: https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5
- ical.js gap/fold behaviour: `services/api/node_modules/ical.js/lib/ical/timezone.js:354`
- Research §2: the audit research notes (kept outside the repository)

# 0003. One time-zone identifier resolver

- Status: accepted; step 4 span start amended by 0012
- Date: 2026-11-03
- Tasks: C2 (owner); consumers S-ENGINE, S-CALDAV-ZONE, S-RECUR, S-API-TIME, S-FREETIME

## Context and problem statement

Two resolvers disagree. `normalizeTimezone` + `isSupportedTimeZone` (Windows names only) is used by `detach-projected-vtimezones.ts:46`, `resolve-zoned-instants.ts:66`, `build-vtimezone`, `build-zoned-date` and `timezone-instant.resolveTimeZone`. The prefix- and offset-aware `resolve-timezone-identifier.ts` is used only on the recurrence path. Anything the first misses falls through to ts-ics: finding C (server-local fallback) and B2 (Mozilla/tzurl prefixes). Its fixed-offset fallback handles only whole hours (`resolve-timezone-identifier.ts:65`), so custom `(UTC+05:30)` / `(UTC+05:45)` recurring events are dropped (finding D).

## Decision drivers

1. Owner: find and fix discrepancies that put events at the wrong time, drop or duplicate them; root fixes, no per-zone cases.
2. Destinations (CalDAV VTIMEZONE builder, outbound ICS feed `TZID`) need real IANA ids; never write a guessed time.
3. `.oxlintrc.json:27` sets `import/no-cycle` to error, and `timezone-instant.ts` already imports `normalize-timezone.ts`.

## Considered options

- A. Fixed offsets resolve to a raw `"+05:30"` Intl string.
- B. Fixed offsets resolve to the IANA zone that has held that exact offset from 1970 to 2100, found generically.
- C. Only make `normalizeTimezone` delegate for Windows names.

## Decision outcome

B, with every path going through one core (A's full-wrapper shape). C leaves B2 alive on non-recurring paths. A would put a non-IANA label into CalDAV `TZID`s and feed output. Note: the Google writer's `timeZone` field is only sent on a recurring branch that no caller reaches (`google/destination/serialize-event.ts:8-22`, see ADR 0008), so Google is not the reason for B; CalDAV and feed output are.

### Interface contract (exact)

```ts
type DeclaredTimeZoneOffsets = /* unchanged existing type */;
type ResolvedTimeZone =
  | { kind: "iana"; timeZone: string }
  | { kind: "fixed-offset"; timeZone: string; offsetMinutes: number };

const resolveTimeZoneIdentifier: (
  identifier: string | undefined,
  declaredOffsets?: DeclaredTimeZoneOffsets,
) => ResolvedTimeZone | undefined;

const resolveDeclaredTimeZone: (identifier, declaredOffsets) => string | undefined; // = resolveTimeZoneIdentifier(...)?.timeZone
const readDeclaredTimeZoneOffsets: /* unchanged */;
const normalizeTimezone: (timezone: string | undefined) => string | undefined; // = resolveTimeZoneIdentifier(tz)?.timeZone ?? tz
```

Resolution order (named steps, no zone-name comparisons):
1. `resolveWindowsName`: Windows name via the CLDR `WINDOWS_TO_IANA` map.
2. `resolveIntlName`: any name `Intl` accepts (IANA names and links: `Asia/Calcutta`, `US/Eastern`, `Asia/Rangoon`, `Europe/Kiev`).
3. `resolvePrefixedName`: trailing IANA zone of a `/`-prefixed tzurl id (`/mozilla.org/...`, `/citadel.org/...`).
4. `resolveDeclaredFixedOffset`: only with `declaredOffsets`, only when the VTIMEZONE's `TZOFFSETTO` values reduce to exactly one whole-minute offset within ±14:00. Zero gives `Etc/UTC`, whole hours give `Etc/GMT∓N` (unchanged). Other offsets give the lexicographically first `Intl.supportedValuesOf("timeZone")` zone whose offset equals it in January and July of every year 1970-2100 (cheap two-instant prefilter, lazy, memoised per offset). `+05:30` → `Asia/Calcutta`, `+05:45` → `Asia/Katmandu`. No such zone, an offset with seconds, or a changing offset → `undefined`.

Steps 1-3 yield `{ kind: "iana" }`, step 4 `{ kind: "fixed-offset" }`.

### Binding rules

1. New leaf module `packages/calendar/src/ics/utils/intl-time-zone.ts` (granted to C2) holds the bare memoised Intl probe (`canFormatTimeZone(timeZone: string): boolean`) and any Intl offset reading the constancy check needs. Dependency direction is one-way: `timezone-instant → normalize-timezone → resolve-timezone-identifier → {windows-timezones, intl-time-zone}`. The resolver never imports `timezone-instant`. Its private duplicate `isSupportedTimeZone` is deleted; `timezone-instant.isSupportedTimeZone` stays the only exported one and is not edited by C2.
2. Display labels without a declared VTIMEZONE (`GMT+8`, `(UTC+08:00) Kuala Lumpur, Singapore`) are never parsed and stay unresolved. They become unsupported downstream (ADR 0004), never a server-local time.
3. A DST-changing custom VTIMEZONE is never mapped to a fixed offset.
4. Stored spelling: unresolvable labels are stored exactly as given. Identifiers that resolve to IANA (tzurl prefixes, Windows names) are stored as the IANA name because `parse-ics-events.ts:14` stores `normalizeTimezone` output. This one-time spelling change causes one hash flip and replace per affected copy, no duplicates. Tests in other slices that assert prefixed spelling are updated by their owners.
5. Services (`services/api`) resolve caller-supplied zones through the existing public `resolveTimeZone` from `@keeper.sh/calendar` (it already routes through `normalizeTimezone` and throws `RangeError` on unsupported input). No new public export is needed for them. In-package consumers (S-ENGINE, S-CALDAV-ZONE) import `resolveTimeZoneIdentifier` from the module file.
6. Tests pin the exact chosen names and also assert the chosen zone's Intl offset equals `offsetMinutes`, so ICU drift fails loudly. End-to-end through `createIcsSourceFetcher` with exact UTC instants for the +05:30 and +05:45 custom zones, under `TZ=UTC` and `TZ=America/Edmonton`. Regression table: Asia/Calcutta, US/Eastern, Asia/Rangoon, Europe/Kiev, Asia/Kathmandu, Pacific/Chatham, `Eastern Standard Time`, `Alberta Standard Time`, `/mozilla.org/20050126_1/America/Denver`, `/citadel.org/20190914_1/Europe/London`.
7. S-ENGINE deletes `synthesize-vtimezones.ts`; before that, a test lists every name class it covered (Windows names, IANA links) and asserts C2 resolves each.
8. Report: custom fixed offsets with no constant IANA zone (for example -03:30, +12:45) stay unsupported, stated plainly.

### Consequences

- Good: every path resolves identically; B2 prefix fallthrough and D closed at the root.
- Bad: depends on ICU's zone list (pinned by tests); a fixed-offset Exchange zone shows as `Asia/Calcutta` at destinations (cosmetic; instant correct).

## Agent context

- `packages/calendar/src/ics/utils/resolve-timezone-identifier.ts:65` (whole-hour limit), `:137` exports
- `packages/calendar/src/ics/utils/normalize-timezone.ts`, `timezone-instant.ts:1,48-69`
- `packages/calendar/src/ics/utils/parse-ics-events.ts:14`
- `.oxlintrc.json:27`
- RFC 7809 (built-in definitions for known ids): https://datatracker.ietf.org/doc/rfc7809
- ts-ics server-local fallback: https://github.com/Neuvernetzung/ts-ics/blob/master/packages/ts-ics/src/utils/timezone/getOffsetFromTimezoneId.ts
- Research §2 items 1 and 3, finding D

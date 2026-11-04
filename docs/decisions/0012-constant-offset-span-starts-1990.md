# 0012. The constant-offset span for custom fixed zones starts in 1990

- Status: accepted
- Date: 2026-11-03
- Supersedes: the 1970 start of the January/July constancy span in 0003, outcome step 4 and option B
- Tasks: C2 (owner); recorded by INTEGRATE wave 2

## Context and problem statement

0003 step 4 maps a custom VTIMEZONE holding one non-whole-hour offset to the lexicographically first IANA zone whose offset equals it in January and July of every year 1970-2100, and pins `+05:45` to `Asia/Katmandu`. Both cannot hold: Nepal was on `+05:30` until 1986, so with a 1970 start no zone qualifies for `+05:45` and `(UTC+05:45)` custom recurring series stay dropped (finding D). Probed on Bun 1.3.6 and 1.3.11 with the vendored ICU data: from 1970, 330 → `[Asia/Calcutta]`, 345 → `[]`, 390 → `[Asia/Rangoon, Indian/Cocos]`; from 1990, 345 → `[Asia/Katmandu]`.

## Decision outcome

The constancy span is January and July of every year 1990-2100 (`FIRST_CONSTANT_OFFSET_YEAR = 1990` in `packages/calendar/src/ics/utils/resolve-timezone-identifier.ts`). Everything else in 0003 is unchanged.

- `+05:30` still gives `Asia/Calcutta`; `Asia/Colombo` stays excluded by its 1996-2006 change.
- `+05:45` gives `Asia/Katmandu`, `+06:30` still gives `Asia/Rangoon`.
- Offsets no zone holds over 1990-2100 (for example -03:30, +12:45) stay unsupported, as 0003 rule 8 says.

### Consequences

- Good: Nepal-offset custom zones are no longer dropped, which is what the owner asked for.
- Bad: for instants before the chosen zone's last pre-1990 change (Kathmandu before 1986) the mapped zone's offset differs from the declared one. Sync windows sit around today, and recurrence expands by wall time, so occurrences users see are unaffected.

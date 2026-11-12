# 0014. The two pre-0004 VTIMEZONE tests follow IANA-wins

- Status: accepted
- Date: 2026-11-03
- Supersedes: the file grant in 0004 rule 8, extended to one test case each in `packages/calendar/tests/providers/caldav/shared/ics-timezone.test.ts` and `packages/calendar/tests/ics/utils/parse-ics-calendar.test.ts`
- Tasks: S-ENGINE (owner); recorded by INTEGRATE wave 4

## Context and problem statement

0004 rule 1 makes IANA rules decide every TZID that resolves, even when the calendar declares a disagreeing VTIMEZONE, and names the flip of the #1094 "explicit observance set authoritative" test as a policy change. 0004 rule 5 removes every VTIMEZONE before ts-ics parses the text. Two tests outside 0004's file grants still encode the old policy and fail with the engine:

1. `ics-timezone.test.ts` "keeps an explicit VTIMEZONE authoritative over the IANA database" expects a fixed -0700 block declared under `TZID:America/Edmonton` to win (`2026-03-08T15:00:00.000Z`).
2. `parse-ics-calendar.test.ts` "throws on malformed timezone blocks" expects the whole calendar to throw on a `DTSTART:INVALID` observance under `TZID:America/New_York`. ts-ics no longer sees that block.

## Decision outcome

1. The first test becomes "follows IANA rules for an IANA TZID even when its declared VTIMEZONE disagrees" and expects `2026-03-08T14:00:00.000Z` (08:00 local on 2026-03-08 is MDT, after that morning's 02:00 change).
2. The second test becomes "reads an IANA TZID by IANA rules when its declared VTIMEZONE block is malformed" and expects `2026-03-10T13:00:00.000Z` (09:00 EDT). A malformed block under an unresolvable TZID still withholds that one event, per 0004 rule 1.3 and rule 7.

Everything else in 0004 is unchanged.

### Consequences

- Good: both tests now pin the behaviour 0004 chose; one bad VTIMEZONE no longer aborts a whole feed or CalDAV read.
- Bad: senders who ship custom rules under real IANA names are read by IANA rules, as 0004 already accepts.

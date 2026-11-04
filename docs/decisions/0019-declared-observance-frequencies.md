# 0019. Declared VTIMEZONE observances expand only at frequencies ical.js can give up on

- Status: accepted
- Date: 2026-11-03
- Amends: 0004 (which observance rules the declared engine expands)
- Tasks: review fix round

## Context and problem statement

47c99603 stopped rejecting non-YEARLY observance rules and let any rule through whose onset count was small. The count bounds the onsets a rule can produce, not the steps ical.js takes to find them. For SECONDLY, MINUTELY, HOURLY and DAILY, `RecurIterator.next()` keeps stepping until the contracting rules pass and has no guard for a rule that never matches, so `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30` never returns. That runs on every remote ICS feed, so one feed could stall the shared sync worker for every user. The sub-daily onset bound also left out the BYMINUTE and BYSECOND multiplier, so `FREQ=HOURLY;INTERVAL=24;BYMINUTE=0..59;BYSECOND=0..59` passed the 50,000-onset guard and expanded millions of onsets.

## Decision outcome

1. An observance RRULE is expanded only when its FREQ is YEARLY or MONTHLY (ical.js gives up after 28 or 336 steps that match nothing), or WEEKLY with no BYMONTH, BYMONTHDAY, BYWEEKNO or BYYEARDAY filter (every step then matches).
2. Any other observance rule makes its zone unreadable: the RangeError is raised before ical.js runs, and events in that zone are withheld as unsupported (0004 rule 1.3).
3. The onset bound counts only the frequencies in rule 1, so it has no sub-daily branch.

### Consequences

- Good: no declared VTIMEZONE can put ical.js into an endless loop, and the MONTHLY and WEEKLY zones 47c99603 meant to keep still read.
- Bad: a custom zone that declares a DAILY or sub-daily observance, or a filtered WEEKLY one, is withheld. No real-world writer is known to produce one.

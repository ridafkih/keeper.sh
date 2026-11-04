# 0018. DATE EXDATE slots are charged to their own series and degrade instead of withholding

- Status: accepted
- Date: 2026-11-03
- Amends: 0006 rule 3 and 0015 (how many slots a DATE EXDATE may expand to, and what happens past that)
- Tasks: review fix round

## Context and problem statement

1c3ee29b and 6107c509 bounded DATE EXDATE expansion with one budget of 3,000 added slots shared by every event in a calendar. Once earlier series had spent it, the next series whose DATE EXDATE added even one slot threw a RangeError and was withheld, so which series reached destinations depended on feed order, not on the series. A selector-free HOURLY series adds 23 slots per excluded day, so about 130 excluded days across a calendar's hourly series were enough. The number was set by sync-worker latency (about 0.17 ms per slot) and suite timeouts, not by real feeds. That breaks 0006 driver 3 ("don't trade a ghost for a dropped series") and rule 3 ("never throw or withhold").

Measured on the branch: the 0.17 ms per slot is ts-ics converting each TZID-qualified EXDATE value. The same 2,880 slots written as UTC instants parse in about 2 ms instead of about 500 ms.

## Decision outcome

1. When the series zone resolves (IANA, a fixed offset, or UTC), every DATE EXDATE slot is written as a UTC instant, resolved through the same `wallTimeToInstant` path as every other wall time (0006 rule 5). Only a zone with no resolvable name keeps its slots as wall times under the series TZID.
2. Each series (master UID) may add 10,000 slots beyond the one each excluded date names. That covers a selector-free HOURLY series excluding about 430 days, or a DAILY BYHOUR=9,13,17 series excluding 5,000.
3. A calendar may add 50,000 slots in all, which bounds a hostile feed to well under a second of sync-worker time.
4. A date that does not fit either budget excludes only the master's DTSTART time of day, the 0006 rule 3 form that MINUTELY and SECONDLY already use. Nothing is withheld for going over a budget. The 1,440-slots-per-date cap on selector lists still withholds the series that asks for more, because that series is malformed by itself.

### Consequences

- Good: a valid series is never withheld because of other events in the feed, and a series that outgrows its own budget keeps syncing.
- Bad: past a budget, an excluded day keeps occurrences other than the DTSTART time of day (ghosts). Past the calendar budget, later series in feed order get that form. A local-day exclusion matched in the materializer would remove the budget altogether, but it means carrying DATE exclusions through stored recurrence data (0006 option A); it is a remaining gap in the report.

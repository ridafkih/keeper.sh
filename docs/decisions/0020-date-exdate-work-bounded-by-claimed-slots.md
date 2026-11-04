# 0020. DATE EXDATE work is bounded by the slots a calendar claims

- Status: accepted
- Date: 2026-11-03
- Amends: 0018 rules 1 and 3 (which zones expand a DATE EXDATE, and what bounds its cost)
- Tasks: review fix round

## Context and problem statement

0018 rule 3 says the 50,000-slot calendar budget "bounds a hostile feed to well under a second of sync-worker time". Two paths broke that. Every date built its full slot list before claiming the budget, so dates past the budget still paid for up to 1,440 slots each: 50,000 such dates took about 4.7 s. And a series whose zone does not resolve still expanded every slot and wrote them as wall times under its TZID, the 0.17 ms-per-value form 0018 measured, under budgets sized for UTC instants: five hourly series excluding 430 days took about 9.4 s. That series is withheld as unsupported by `resolveRecurrenceTimeZones`, so the slots never reached a destination.

## Decision outcome

1. A date's slot count comes from the rule before any slot is built: the selector product for selector rules, or the elapsed hours between the day's local midnights for a selector-free HOURLY rule. Slots are built only after the claim succeeds; a failed claim goes straight to the DTSTART time-of-day slot.
2. A series in a zone with no resolvable name gets only its DTSTART time of day for each excluded date, written as a wall time under its declared TZID. This replaces the unresolved-zone branch of 0018 rule 1. The series is withheld either way.
3. With both, a calendar's DATE EXDATE work is bounded by the slots it claims plus one per date, all written as UTC instants. 0018 rule 3's sub-second bound now holds for every path.

### Consequences

- Good: no feed can spend sync-worker time on slots that are discarded or never synced.
- Bad: none found. The unresolved-zone EXDATE line is shorter, but the series it belongs to is never synced.

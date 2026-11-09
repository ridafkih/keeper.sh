# 0015. A DATE EXDATE on a filtered HOURLY series covers every hour of the local day

- Status: accepted
- Date: 2026-11-03
- Supersedes: the "each defaulting to DTSTART's" clause of 0006 rule 3, for HOURLY series only
- Tasks: S-RECUR (owner); recorded by INTEGRATE wave 5

## Context and problem statement

0006 rule 3 expands a DATE EXDATE on a timed master to every wall time the rule yields that local day, as BYHOUR × BYMINUTE × BYSECOND with each part defaulting to DTSTART's component. An HOURLY series steps through hours, so with no BYHOUR it occurs in every interval-aligned hour, not only DTSTART's. An HOURLY series with BYMINUTE or BYSECOND but no BYHOUR would keep ghost occurrences on a day its sender excluded.

## Decision outcome

1. For HOURLY, a missing BYHOUR expands to all 24 hours of the local day. BYMINUTE and BYSECOND still default to DTSTART's components.
2. The result can name instants the series never yields (hours off the interval). Excluding a time that is not an occurrence has no effect, so the set is a safe superset of the day's slots.
3. DAILY and slower rules keep DTSTART's hour, as 0006 rule 3 says. Selector-free HOURLY and MINUTELY/SECONDLY are unchanged from 0006 rule 3.

### Consequences

- Good: an excluded local day keeps no occurrence of a filtered HOURLY series.
- Bad: the outbound EXDATE list for such a series is up to 24 times longer than its DTSTART-hour form.

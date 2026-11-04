# 0013. The CalDAV demand-telemetry test mock follows resolveCalendar

- Status: accepted
- Date: 2026-11-03
- Supersedes: the file grant in 0005 rule 6, for one mock key in `packages/calendar/tests/providers/caldav/source/provider-demand-telemetry.test.ts`
- Tasks: S-CALDAV-ZONE (owner); recorded by INTEGRATE wave 3

## Context and problem statement

0005 rule 3 and its interface contract make the CalDAV source call `client.resolveCalendar(storedUrl)` so the collection zone travels with the URL. `provider-demand-telemetry.test.ts` sits outside 0005's file grants and mocks a `CalDAVClient` with only `resolveCalendarUrl`. With the source calling `resolveCalendar`, its two reauth telemetry tests fail with `resolveCalendar is not a function` before the mocked 401 is reached.

## Decision outcome

The mock key `resolveCalendarUrl` becomes `resolveCalendar` with the same failing body, so the test still drives the 401 path it was written for. No assertion changes. Everything else in 0005 is unchanged.

### Consequences

- Good: the telemetry tests exercise the reauth path through the method the source now calls.
- Bad: none; the test's expectations are unchanged.

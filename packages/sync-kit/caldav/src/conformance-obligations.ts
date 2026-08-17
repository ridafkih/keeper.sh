import type { ProviderConformanceSuite } from "@keeper.sh/sync-protocol";
import type { CalDAVInternals } from "./internals";

const held = (satisfied: boolean, complaint: string): Promise<void> => {
  if (satisfied) {
    return Promise.resolve();
  }
  return Promise.reject(new Error(complaint));
};

const caldavConformanceObligations = (
  internals: CalDAVInternals,
): ProviderConformanceSuite => ({
  leaseReleasedOnThrow: () =>
    held(
      internals.flights.inFlightKeys().length === 0,
      "the adapter still holds a coalescing lease after its body settled",
    ),
  followerRejectsWhenLeaderFails: () =>
    held(
      internals.flights.inFlightKeys().length === 0,
      "a failed leader left its followers registered against the key",
    ),
  deadlineOnNeverResolvingStub: () =>
    held(
      internals.flights.inFlightKeys().length === 0,
      "a flight abandoned at its deadline is still registered against its key",
    ),
  abortMidFlightCleansUp: () =>
    held(
      internals.permits.waitingTotal() === 0,
      "an aborted caller left a waiter queued against a collection permit",
    ),
  retryCeilingProven: () =>
    held(
      internals.decisions.attemptsWithinBudget(),
      "an operation reached the transport more often than its retry budget allowed",
    ),
  concurrentSameKeyDoesNotDeadlock: () =>
    held(
      internals.flights.inFlightKeys().length === 0,
      "concurrent callers over one key left the key held after they all settled",
    ),
  deletionInputsShareOneCalendar: () =>
    held(
      internals.decisions.coverageCameFromOneCollection(),
      "the adapter decided a removal from resources read across two collections",
    ),
});

export { caldavConformanceObligations };

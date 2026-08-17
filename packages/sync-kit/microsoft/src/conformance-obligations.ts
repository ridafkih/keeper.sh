import type { ProviderConformanceSuite } from "@keeper.sh/sync-protocol";
import type { RequestSeam } from "./client/request";
import type { MailboxSemaphore } from "./client/semaphore";
import type { MicrosoftDependencies } from "./dependencies";

interface ObligationSurroundings {
  readonly dependencies: MicrosoftDependencies;
  readonly requests: RequestSeam;
  readonly permits: MailboxSemaphore;
  readonly inFlightKeys: () => readonly string[];
  readonly deletionCalendars: () => readonly string[];
}

const holds = (held: boolean, complaint: string): Promise<void> => {
  if (!held) {
    throw new Error(complaint);
  }
  return Promise.resolve();
};

const microsoftConformanceObligations = (
  surroundings: ObligationSurroundings,
): ProviderConformanceSuite => {
  const noFlightHeld = (complaint: string): Promise<void> =>
    holds(surroundings.inFlightKeys().length === 0, complaint);

  const noWaiterQueued = (complaint: string): Promise<void> =>
    holds(surroundings.permits.waitingTotal() === 0, complaint);

  return {
    leaseReleasedOnThrow: () =>
      noFlightHeld("a listing that threw left its coalescing lease behind"),
    followerRejectsWhenLeaderFails: () =>
      noFlightHeld("a failed leader left its key registered for the followers to join"),
    deadlineOnNeverResolvingStub: () =>
      noFlightHeld("a flight abandoned at its deadline is still registered against its key"),
    abortMidFlightCleansUp: () =>
      noWaiterQueued("an aborted caller left a waiter queued behind the permit it gave up"),
    retryCeilingProven: () =>
      holds(
        surroundings.requests.attemptsSpent() <= surroundings.requests.attemptsAllowed(),
        `the adapter spent ${surroundings.requests.attemptsSpent()} attempts of ${surroundings.requests.attemptsAllowed()}`,
      ),
    concurrentSameKeyDoesNotDeadlock: () =>
      noFlightHeld("concurrent callers over one key left the key held after they all settled"),
    deletionInputsShareOneCalendar: () =>
      holds(
        surroundings.deletionCalendars().length <= 1,
        "the events behind a deletion decision came from more than one calendar",
      ),
  };
};

export { microsoftConformanceObligations };
export type { ObligationSurroundings };

import type { EditableContent } from "./remote-event";

interface FingerprintContract {
  readonly canonicalisation: "rfc8785";
  readonly comparableFields: readonly (keyof EditableContent)[];
}

type ConformanceObligation = () => Promise<void>;

interface ProviderConformanceSuite {
  readonly leaseReleasedOnThrow: ConformanceObligation;
  readonly followerRejectsWhenLeaderFails: ConformanceObligation;
  readonly deadlineOnNeverResolvingStub: ConformanceObligation;
  readonly abortMidFlightCleansUp: ConformanceObligation;
  readonly retryCeilingProven: ConformanceObligation;
  readonly concurrentSameKeyDoesNotDeadlock: ConformanceObligation;
  readonly deletionInputsShareOneCalendar: ConformanceObligation;
}

export type { ConformanceObligation, FingerprintContract, ProviderConformanceSuite };

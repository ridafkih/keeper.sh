import { describe, expectTypeOf, test } from "vitest";
import type {
  CalendarProvider,
  ConformanceObligation,
  FingerprintContract,
  ProviderContract,
  ProviderConformanceSuite,
} from "../src/index";

declare const obligation: ConformanceObligation;
declare const synchronousObligation: () => void;
declare const provider: CalendarProvider<"google">;
declare const fingerprint: FingerprintContract;
declare const suite: ProviderConformanceSuite;

declare const acceptSuite: (suite: ProviderConformanceSuite) => void;
declare const acceptContract: (contract: ProviderContract<"google">) => void;

describe("obligations the compiler cannot check are still named here", () => {
  test("the conformance suite names every lockup obligation an adapter must prove", () => {
    expectTypeOf<keyof ProviderConformanceSuite>().toEqualTypeOf<
      | "leaseReleasedOnThrow"
      | "followerRejectsWhenLeaderFails"
      | "deadlineOnNeverResolvingStub"
      | "abortMidFlightCleansUp"
      | "retryCeilingProven"
      | "concurrentSameKeyDoesNotDeadlock"
      | "deletionInputsShareOneCalendar"
    >();
  });

  test("an obligation a runner cannot await is not an obligation", () => {
    expectTypeOf<ConformanceObligation>().toEqualTypeOf<() => Promise<void>>();
    acceptSuite({
      // @ts-expect-error a proof whose promise the runner drops passes green without finishing
      leaseReleasedOnThrow: synchronousObligation,
      deadlineOnNeverResolvingStub: obligation,
      abortMidFlightCleansUp: obligation,
      retryCeilingProven: obligation,
      concurrentSameKeyDoesNotDeadlock: obligation,
      followerRejectsWhenLeaderFails: obligation,
      deletionInputsShareOneCalendar: obligation,
    });
  });

  test("a suite that omits an obligation does not satisfy the contract", () => {
    // @ts-expect-error an adapter cannot ship without proving its lease releases on a throw
    acceptSuite({
      deadlineOnNeverResolvingStub: obligation,
      abortMidFlightCleansUp: obligation,
      retryCeilingProven: obligation,
      concurrentSameKeyDoesNotDeadlock: obligation,
      followerRejectsWhenLeaderFails: obligation,
      deletionInputsShareOneCalendar: obligation,
    });
  });

  test("an adapter ships its provider together with the proofs and the hash contract", () => {
    acceptContract({ provider, fingerprint, conformance: suite });
    // @ts-expect-error a provider with no conformance suite has proven none of the obligations
    acceptContract({ provider, fingerprint });
    // @ts-expect-error two adapters hashing content differently rewrite each other's mirrors
    acceptContract({ provider, conformance: suite });
  });

  test("the fingerprint contract states the canonicalisation adapters must share", () => {
    expectTypeOf<FingerprintContract["canonicalisation"]>().toEqualTypeOf<"rfc8785">();
    expectTypeOf<FingerprintContract>().toHaveProperty("comparableFields");
  });
});

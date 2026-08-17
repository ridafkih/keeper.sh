import { describe, expectTypeOf, test } from "vitest";
import { assertNever } from "../src/index";
import type {
  AccountId,
  Capabilities,
  Instant,
  NotAttemptedReason,
  ObservedPrecondition,
  OperationName,
  Precondition,
  ProviderFailure,
  QuotaScope,
  RepresentabilityConstraint,
} from "../src/index";

declare const scope: QuotaScope;
declare const account: AccountId;

declare const acceptFailure: (failure: ProviderFailure) => void;

describe("failure is typed, never free text", () => {
  test("a ProviderFailure switch that omits reauthRequired fails to compile", () => {
    const isRetryable = (failure: ProviderFailure): boolean => {
      switch (failure.kind) {
        case "rateLimited":
        case "truncated": {
          return true;
        }
        case "cursorInvalid":
        case "conflict":
        case "notFound":
        case "unsupported":
        case "unrepresentable":
        case "notAttempted": {
          return false;
        }
        case "transport": {
          return failure.disposition === "transient";
        }
        default: {
          // @ts-expect-error reauth retried as a transient error burns quota and never succeeds
          return assertNever(failure);
        }
      }
    };
    expectTypeOf(isRetryable).returns.toBeBoolean();
  });

  test("reauthRequired names the account that must reauthenticate", () => {
    expectTypeOf<{ readonly kind: "reauthRequired"; readonly account: AccountId }>().toExtend<
      ProviderFailure
    >();
    acceptFailure({ kind: "reauthRequired", account });
  });

  test("rateLimited.retryAfter is Instant | null, never undefined", () => {
    expectTypeOf<
      Extract<ProviderFailure, { kind: "rateLimited" }>["retryAfter"]
    >().toEqualTypeOf<Instant | null>();
    // @ts-expect-error the absent case must be an explicit branch, not a forgotten field
    acceptFailure({ kind: "rateLimited", scope });
  });

  test("transport retryability is a named disposition, never a boolean", () => {
    expectTypeOf<Extract<ProviderFailure, { kind: "transport" }>["disposition"]>().toEqualTypeOf<
      "transient" | "permanent"
    >();
    // @ts-expect-error every boolean verdict in this codebase grew a second field within months
    acceptFailure({ kind: "transport", status: 503, retryable: true });
  });

  test("normalization can refuse an event without throwing or mislabelling it", () => {
    expectTypeOf<OperationName>().toEqualTypeOf<
      "listCalendars" | "listChanges" | "normalize" | "write"
    >();
    expectTypeOf<
      Extract<ProviderFailure, { kind: "unrepresentable" }>["constraint"]
    >().toEqualTypeOf<RepresentabilityConstraint>();
    acceptFailure({ kind: "unrepresentable", constraint: "minimumSpan" });
    acceptFailure({ kind: "unsupported", operation: "normalize" });
  });

  test("a conflict reports state the provider actually observed", () => {
    expectTypeOf<Extract<ProviderFailure, { kind: "conflict" }>["observed"]>().toEqualTypeOf<
      ObservedPrecondition
    >();
    expectTypeOf<ObservedPrecondition>().toEqualTypeOf<
      Exclude<Precondition, { kind: "absent" }>
    >();
    expectTypeOf<Capabilities["precondition"]>().toEqualTypeOf<ObservedPrecondition["kind"]>();
    // @ts-expect-error "it wasn't there" is notFound, never a comparison against observed state
    acceptFailure({ kind: "conflict", observed: { kind: "absent" } });
  });

  test("a failure carries no free-text message to classify on", () => {
    acceptFailure({
      kind: "transport",
      status: 503,
      disposition: "transient",
      // @ts-expect-error classifying by message substring is how reauth was missed for months
      message: "service unavailable",
    });
  });

  test("an unattempted operation reports one of the shared, typed reasons", () => {
    expectTypeOf<
      Extract<ProviderFailure, { kind: "notAttempted" }>["reason"]
    >().toEqualTypeOf<NotAttemptedReason>();
  });
});

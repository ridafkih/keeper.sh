import { describe, expectTypeOf, test } from "vitest";
import { assertNever } from "../src/index";
import type {
  DeleteHandle,
  EchoVerdict,
  NotAttemptedReason,
  ObservedPrecondition,
  ProviderFailure,
  RemoteRef,
  RemoteVersion,
  WriteOutcome,
} from "../src/index";

declare const remote: RemoteRef;
declare const version: RemoteVersion;
declare const echo: EchoVerdict;
declare const conflict: Extract<WriteOutcome, { kind: "conflict" }>;

declare const acceptOutcome: (outcome: WriteOutcome) => void;
declare const recordMapping: (
  outcome: Extract<
    WriteOutcome,
    { kind: "created" } | { kind: "updated" } | { kind: "alreadyExists" } | { kind: "unchanged" }
  >,
) => void;

describe("an outcome says exactly what happened", () => {
  test("a WriteOutcome switch that omits conflict fails to compile", () => {
    const backoffVerdict = (outcome: WriteOutcome): string => {
      switch (outcome.kind) {
        case "created":
        case "updated":
        case "alreadyExists":
        case "unchanged":
        case "deleted":
        case "alreadyAbsent": {
          return "clear";
        }
        case "unrepresentable": {
          return "hold";
        }
        case "notAttempted": {
          return "preserve";
        }
        default: {
          // @ts-expect-error a stale precondition must not be folded into a generic failure
          return assertNever(outcome);
        }
      }
    };
    expectTypeOf(backoffVerdict).returns.toBeString();
  });

  test("a conflict is an outcome in its own right", () => {
    expectTypeOf<{
      readonly kind: "conflict";
      readonly remote: RemoteRef;
      readonly observed: ObservedPrecondition;
    }>().toExtend<WriteOutcome>();
  });

  test("there is no outcome in which a mismatched precondition succeeded", () => {
    expectTypeOf<Extract<WriteOutcome, { kind: "updated" }>>().toEqualTypeOf<{
      readonly kind: "updated";
      readonly remote: RemoteRef;
      readonly version: RemoteVersion;
      readonly echo: EchoVerdict;
    }>();
    expectTypeOf<Extract<WriteOutcome, { kind: "conflict" }>>().toEqualTypeOf<{
      readonly kind: "conflict";
      readonly remote: RemoteRef;
      readonly observed: ObservedPrecondition;
    }>();
    // @ts-expect-error a conflict is not a version advance and must not update the mapping
    recordMapping(conflict);
  });

  test("echo is three-state and a boolean is not assignable", () => {
    acceptOutcome({
      kind: "created",
      remote,
      version,
      // @ts-expect-error "we never looked" must be distinguishable from "we looked and it matched"
      echo: true,
    });
    const drift = (verdict: EchoVerdict): string => {
      switch (verdict.kind) {
        case "matched": {
          return "none";
        }
        case "diverged": {
          return "recorded";
        }
        default: {
          // @ts-expect-error dropping notObserved hides a whole drift class
          return assertNever(verdict);
        }
      }
    };
    expectTypeOf(drift).returns.toBeString();
  });

  test("a created outcome must report what the echo showed", () => {
    // @ts-expect-error an unexamined write is not a verified write
    acceptOutcome({ kind: "created", remote, version });
    expectTypeOf<Extract<WriteOutcome, { kind: "created" }>["echo"]>().toEqualTypeOf<EchoVerdict>();
  });

  test("an unattempted run is neither success nor failure", () => {
    expectTypeOf<Extract<WriteOutcome, { kind: "notAttempted" }>["reason"]>().toEqualTypeOf<
      NotAttemptedReason
    >();
    expectTypeOf<Extract<ProviderFailure, { kind: "notAttempted" }>["reason"]>().toEqualTypeOf<
      NotAttemptedReason
    >();
  });

  test("a remote reference carries the handle a later delete will need", () => {
    expectTypeOf<RemoteRef>().toHaveProperty("deleteHandle");
    expectTypeOf<RemoteRef["deleteHandle"]>().toEqualTypeOf<DeleteHandle>();
  });

  test("an observed precondition is the only place a conflict reports state", () => {
    expectTypeOf<Extract<WriteOutcome, { kind: "conflict" }>["observed"]>().toEqualTypeOf<
      ObservedPrecondition
    >();
    expectTypeOf(echo).not.toBeBoolean();
  });
});

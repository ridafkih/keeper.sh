import type { BoundedSample } from "./diagnostics";
import type { DeleteHandle, RemoteEventId, RemoteVersion } from "./handles";
import type { ObservedPrecondition } from "./precondition";

interface RemoteRef {
  readonly id: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
}

type EchoVerdict =
  | { readonly kind: "matched" }
  | { readonly kind: "diverged"; readonly fields: BoundedSample }
  | { readonly kind: "notObserved" };

const notAttemptedReasons = ["superseded", "aborted", "budgetExhausted"] as const;
type NotAttemptedReason = (typeof notAttemptedReasons)[number];

const representabilityConstraints = [
  "minimumSpan",
  "invertedRange",
  "allDayGrid",
  "recurrenceDialect",
  "zoneIdentifier",
] as const;
type RepresentabilityConstraint = (typeof representabilityConstraints)[number];

type WriteOutcome =
  | {
      readonly kind: "created";
      readonly remote: RemoteRef;
      readonly version: RemoteVersion;
      readonly echo: EchoVerdict;
    }
  | {
      readonly kind: "updated";
      readonly remote: RemoteRef;
      readonly version: RemoteVersion;
      readonly echo: EchoVerdict;
    }
  | { readonly kind: "alreadyExists"; readonly remote: RemoteRef; readonly version: RemoteVersion }
  | { readonly kind: "unchanged"; readonly remote: RemoteRef; readonly version: RemoteVersion }
  | { readonly kind: "deleted"; readonly remote: RemoteRef }
  | { readonly kind: "alreadyAbsent"; readonly remote: RemoteRef }
  | {
      readonly kind: "conflict";
      readonly remote: RemoteRef;
      readonly observed: ObservedPrecondition;
    }
  | { readonly kind: "unrepresentable"; readonly constraint: RepresentabilityConstraint }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

export { notAttemptedReasons, representabilityConstraints };
export type {
  EchoVerdict,
  NotAttemptedReason,
  RemoteRef,
  RepresentabilityConstraint,
  WriteOutcome,
};

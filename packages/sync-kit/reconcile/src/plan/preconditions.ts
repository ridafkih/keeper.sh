import type { ObservedPrecondition, RemoteEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { joinOnNul } from "../identity/nul";

const observedPreconditionOf = (
  event: RemoteEvent,
  kind: ObservedPrecondition["kind"],
): ObservedPrecondition => {
  switch (kind) {
    case "matchesVersion": {
      return { kind: "matchesVersion", version: event.version };
    }
    case "matchesFingerprint": {
      return { kind: "matchesFingerprint", fingerprint: event.fingerprint };
    }
    default: {
      return assertNever(kind);
    }
  }
};

const preconditionSignature = (precondition: ObservedPrecondition): string => {
  switch (precondition.kind) {
    case "matchesVersion": {
      return joinOnNul([precondition.kind, precondition.version.value]);
    }
    case "matchesFingerprint": {
      return joinOnNul([precondition.kind, precondition.fingerprint.value]);
    }
    default: {
      return assertNever(precondition);
    }
  }
};

const samePrecondition = (left: ObservedPrecondition, right: ObservedPrecondition): boolean =>
  preconditionSignature(left) === preconditionSignature(right);

export { observedPreconditionOf, samePrecondition };

import type { ObservedPrecondition, RemoteVersion } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

type MicrosoftPrecondition =
  | { readonly kind: "enforced"; readonly ifMatch: string }
  | { readonly kind: "verified"; readonly expected: RemoteVersion }
  | { readonly kind: "unsupported" };

const enforcedPrecondition = (precondition: ObservedPrecondition): MicrosoftPrecondition => {
  switch (precondition.kind) {
    case "matchesVersion": {
      return { kind: "enforced", ifMatch: precondition.version.value };
    }
    case "matchesFingerprint": {
      return { kind: "unsupported" };
    }
    default: {
      return assertNever(precondition);
    }
  }
};

const verifiedPrecondition = (precondition: ObservedPrecondition): MicrosoftPrecondition => {
  switch (precondition.kind) {
    case "matchesVersion": {
      return { kind: "verified", expected: precondition.version };
    }
    case "matchesFingerprint": {
      return { kind: "unsupported" };
    }
    default: {
      return assertNever(precondition);
    }
  }
};

const matchesObserved = (
  precondition: ObservedPrecondition,
  observed: RemoteVersion,
): boolean => {
  const expected = verifiedPrecondition(precondition);
  if (expected.kind !== "verified") {
    return false;
  }
  return expected.expected.value === observed.value;
};

export { enforcedPrecondition, matchesObserved, verifiedPrecondition };
export type { MicrosoftPrecondition };

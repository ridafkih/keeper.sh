import type { ObservedPrecondition, Precondition } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

type ConditionalHeaders =
  | { readonly kind: "ifMatch"; readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: "ifNoneMatch"; readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: "unusable"; readonly precondition: Precondition };

const conditionalHeaders = (precondition: Precondition): ConditionalHeaders => {
  switch (precondition.kind) {
    case "absent": {
      return { kind: "ifNoneMatch", headers: { "if-none-match": "*" } };
    }
    case "matchesVersion": {
      if (precondition.version.value.length === 0) {
        return { kind: "unusable", precondition };
      }
      return { kind: "ifMatch", headers: { "if-match": precondition.version.value } };
    }
    case "matchesFingerprint": {
      return { kind: "unusable", precondition };
    }
    default: {
      return assertNever(precondition);
    }
  }
};

const observedHeaders = (precondition: ObservedPrecondition): ConditionalHeaders =>
  conditionalHeaders(precondition);

export { conditionalHeaders, observedHeaders };
export type { ConditionalHeaders };

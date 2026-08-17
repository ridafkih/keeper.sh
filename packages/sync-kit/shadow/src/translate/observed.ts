import type { ChangeListing } from "@keeper.sh/sync-protocol";
import type { ObservedState } from "@keeper.sh/sync-reconcile";
import type { SynthesizedSourceListing } from "./listing";

interface ObservedStateRequest {
  readonly source: SynthesizedSourceListing;
  readonly destination: ChangeListing;
}

const buildObservedState = (request: ObservedStateRequest): ObservedState => ({
  kind: "bothSides",
  source: request.source,
  destination: request.destination,
});

export { buildObservedState };
export type { ObservedStateRequest };

import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { observedSourceIdentity } from "../identity/observed-identity";
import type { SourceIdentity } from "../identity/source-identity";
import { classifyProvenance } from "../plan/echo";
import type { ReconciliationPolicy } from "../policy";
import { isRecurring } from "./event-shape";

type Observation =
  | { readonly kind: "usable"; readonly identity: SourceIdentity; readonly event: RemoteEvent }
  | { readonly kind: "suppressedEcho"; readonly identity: SourceIdentity; readonly event: RemoteEvent }
  | { readonly kind: "indeterminate"; readonly identity: SourceIdentity; readonly event: RemoteEvent }
  | { readonly kind: "unsupported"; readonly identity: SourceIdentity; readonly event: RemoteEvent }
  | { readonly kind: "unidentified"; readonly event: RemoteEvent };

const writtenByAnInstallation = (event: RemoteEvent, policy: ReconciliationPolicy): boolean => {
  const disposition = classifyProvenance(event, policy.installation);
  return disposition === "ourMirror" || disposition === "foreignInstallation";
};

const unsupportedByDestination = (event: RemoteEvent, policy: ReconciliationPolicy): boolean =>
  isRecurring(event) && policy.capabilities.recurrenceWrite === "none";

const classifyObservation = (event: RemoteEvent, policy: ReconciliationPolicy): Observation => {
  const identity = observedSourceIdentity(event);
  if (!identity) {
    return { kind: "unidentified", event };
  }
  if (writtenByAnInstallation(event, policy)) {
    return { kind: "suppressedEcho", identity, event };
  }
  if (classifyProvenance(event, policy.installation) === "indeterminate") {
    return { kind: "indeterminate", identity, event };
  }
  if (unsupportedByDestination(event, policy)) {
    return { kind: "unsupported", identity, event };
  }
  return { kind: "usable", identity, event };
};

const classifyObservations = (
  events: readonly RemoteEvent[],
  policy: ReconciliationPolicy,
): readonly Observation[] => events.map((event) => classifyObservation(event, policy));

export { classifyObservations };
export type { Observation };

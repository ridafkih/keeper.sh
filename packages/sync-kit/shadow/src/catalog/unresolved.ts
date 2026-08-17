import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import type { Plan, Unresolved } from "@keeper.sh/sync-reconcile";
import { classifyProvenance, sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { TranslationUnit } from "../translate/unit";
import type { UnresolvedEntry } from "./entries";
import { destinationEventsOf } from "./resolution";

interface UnresolvedRequest {
  readonly unit: TranslationUnit;
  readonly plan: Plan;
}

const identityKeyOf = (reported: Unresolved): string | null => {
  if (!reported.identity) {
    return null;
  }
  return sourceIdentityKey(reported.identity);
};

const reportedByThePlanner = (request: UnresolvedRequest): readonly UnresolvedEntry[] =>
  request.plan.unresolved.map((reported) => ({
    reason: reported.reason,
    identityKey: identityKeyOf(reported),
    id: reported.id,
    sourceCalendar: request.unit.sourceCalendar,
  }));

const claimedDestinationIds = (unit: TranslationUnit): ReadonlySet<string> =>
  new Set(unit.mappings.entries.map((entry) => entry.destination.id.value));

const writtenByAnotherInstallation = (unit: TranslationUnit, event: RemoteEvent): boolean =>
  classifyProvenance(event, unit.policy.installation) === "foreignInstallation";

const mirrorsOfAnotherInstallation = (request: UnresolvedRequest): readonly UnresolvedEntry[] => {
  const claimed = claimedDestinationIds(request.unit);
  return destinationEventsOf(request.unit).flatMap((event): readonly UnresolvedEntry[] => {
    if (claimed.has(event.id.value)) {
      return [];
    }
    if (!writtenByAnotherInstallation(request.unit, event)) {
      return [];
    }
    return [
      {
        reason: "provenanceIndeterminate",
        identityKey: null,
        id: event.id,
        sourceCalendar: request.unit.sourceCalendar,
      },
    ];
  });
};

const unresolvedOf = (request: UnresolvedRequest): readonly UnresolvedEntry[] => [
  ...reportedByThePlanner(request),
  ...mirrorsOfAnotherInstallation(request),
];

export { unresolvedOf };
export type { UnresolvedRequest };

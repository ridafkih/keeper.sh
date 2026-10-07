import type {
  AuthoritativeRemoval,
  ChangeListing,
  Removal,
  RemoteEventId,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey, uidPresenceKey } from "../identity/source-identity";
import type { ReconciliationPolicy } from "../policy";
import type { KnownEvent, KnownState } from "../state/known";
import type { PresenceBasis } from "./presence-basis";

interface RemovalBasis {
  readonly explicit: readonly AuthoritativeRemoval[];
  readonly absent: readonly SourceIdentity[];
  readonly outOfScope: readonly RemoteEventId[];
}

const emptyRemovalBasis: RemovalBasis = { explicit: [], absent: [], outOfScope: [] };

const outOfScopeRemovals = (removals: readonly Removal[]): readonly RemoteEventId[] =>
  removals.flatMap((removal) => {
    switch (removal.kind) {
      case "outOfScope": {
        return [removal.id];
      }
      case "deleted":
      case "cancelled": {
        return [];
      }
      default: {
        return assertNever(removal);
      }
    }
  });

const authoritativeRemovals = (removals: readonly Removal[]): readonly AuthoritativeRemoval[] =>
  removals.flatMap((removal) => {
    switch (removal.kind) {
      case "deleted":
      case "cancelled": {
        return [removal];
      }
      case "outOfScope": {
        return [];
      }
      default: {
        return assertNever(removal);
      }
    }
  });

const missingFromListing = (event: KnownEvent, presence: PresenceBasis): boolean =>
  !presence.presentKeys.has(sourceIdentityKey(event.identity)) &&
  !presence.presentKeys.has(uidPresenceKey(event.identity.uid));

const absentWithin = (
  listing: Extract<ChangeListing, { kind: "snapshot" }>,
  known: KnownState,
  presence: PresenceBasis,
  policy: ReconciliationPolicy,
): RemovalBasis => {
  if (policy.capabilities.deletionAuthority === "explicitRemovalsOnly") {
    return {
      explicit: authoritativeRemovals(listing.removals),
      absent: [],
      outOfScope: outOfScopeRemovals(listing.removals),
    };
  }
  const absent = known.events
    .filter((event) => missingFromListing(event, presence))
    .map((event) => event.identity);
  return {
    explicit: authoritativeRemovals(listing.removals),
    absent,
    outOfScope: outOfScopeRemovals(listing.removals),
  };
};

const namedRemovals = (listing: Extract<ChangeListing, { kind: "delta" }>): RemovalBasis => ({
  explicit: authoritativeRemovals(listing.removals),
  absent: [],
  outOfScope: outOfScopeRemovals(listing.removals),
});

const removalBasis = (
  listing: ChangeListing,
  known: KnownState,
  presence: PresenceBasis,
  policy: ReconciliationPolicy,
): RemovalBasis => {
  switch (listing.kind) {
    case "delta": {
      return namedRemovals(listing);
    }
    case "snapshot": {
      return absentWithin(listing, known, presence, policy);
    }
    case "partial":
    case "cursorLost": {
      return emptyRemovalBasis;
    }
    default: {
      return assertNever(listing);
    }
  }
};

export { removalBasis };
export type { RemovalBasis };

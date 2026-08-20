import type { AuthoritativeRemoval } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ProvenCoverage } from "../coverage";
import { insideProvenCoverage } from "../coverage";
import { sourceIdentityKey } from "../identity/source-identity";
import type { ReconciliationPolicy } from "../policy";
import type { ListingAuthority } from "../presence/authority";
import { mayRetireItsOwnMirrors } from "../presence/authority";
import type { RemovalBasis } from "../presence/removals";
import type { KnownEvent, KnownIndex, KnownState } from "../state/known";
import type { MappingIndexes } from "../state/mappings";
import type { MirrorIndex } from "../state/mirrors";
import type { Tombstone, TombstoneCause, Unresolved } from "./plan";

interface TombstoneInput {
  readonly removals: RemovalBasis;
  readonly known: KnownState;
  readonly knownIndex: KnownIndex;
  readonly indexes: MappingIndexes;
  readonly mirrors: MirrorIndex;
  readonly coverage: ProvenCoverage;
  readonly claimedMappingKeys: readonly string[];
  readonly authority: ListingAuthority;
  readonly scopeIsTheMirrorWindow: boolean;
  readonly policy: ReconciliationPolicy;
}

interface TombstoneDerivation {
  readonly tombstones: readonly Tombstone[];
  readonly unresolved: readonly Unresolved[];
}

type NamedRow =
  | { readonly kind: "matched"; readonly row: KnownEvent }
  | { readonly kind: "unheldByUs" }
  | { readonly kind: "ambiguous"; readonly removal: AuthoritativeRemoval };

const tombstoneFor = (
  event: KnownEvent,
  cause: TombstoneCause,
  input: TombstoneInput,
): Tombstone => {
  const mapping = input.indexes.bySourceIdentity.get(sourceIdentityKey(event.identity));
  if (!mapping) {
    return { kind: "forgetKnownRow", identity: event.identity, cause };
  }
  return {
    kind: "retireMirror",
    identity: event.identity,
    cause,
    handle:
      input.mirrors.byId.get(mapping.destination.id.value)?.deleteHandle ??
      mapping.destination.deleteHandle,
    precondition: mapping.precondition,
  };
};

const retiredByTheMirrorWindow = (event: KnownEvent, input: TombstoneInput): boolean => {
  if (!mayRetireItsOwnMirrors(input.authority)) {
    return false;
  }
  if (input.scopeIsTheMirrorWindow) {
    return false;
  }
  if (event.recurring) {
    return false;
  }
  if (!input.indexes.bySourceIdentity.has(sourceIdentityKey(event.identity))) {
    return false;
  }
  return !input.policy.withinWindow(input.policy.mirrorWindow, event.time);
};

const absenceIsProven = (event: KnownEvent, input: TombstoneInput): boolean => {
  if (input.coverage.kind === "unproven") {
    return false;
  }
  if (event.recurring) {
    return true;
  }
  return insideProvenCoverage(input.coverage, event.time, input.policy.withinWindow);
};

const corruptRowsReported = (known: KnownState): readonly Unresolved[] =>
  known.corrupt.map((row) => ({ identity: null, id: row.id, reason: "corruptKnownState" }));

const rowNamedBy = (removal: AuthoritativeRemoval, index: KnownIndex): NamedRow => {
  const byRemoteId = index.byRemoteId.get(removal.id.value);
  if (byRemoteId) {
    return { kind: "matched", row: byRemoteId };
  }
  const rows = index.byUid.get(removal.uid.value) ?? [];
  const only = rows.at(0);
  if (rows.length === 1 && only) {
    return { kind: "matched", row: only };
  }
  if (rows.length === 0) {
    return { kind: "unheldByUs" };
  }
  return { kind: "ambiguous", removal };
};

const rowsNamedBy = (input: TombstoneInput): readonly KnownEvent[] =>
  input.removals.explicit.flatMap((removal) => {
    const named = rowNamedBy(removal, input.knownIndex);
    switch (named.kind) {
      case "matched": {
        return [named.row];
      }
      case "unheldByUs":
      case "ambiguous": {
        return [];
      }
      default: {
        return assertNever(named);
      }
    }
  });

const ambiguousRemovalsReported = (input: TombstoneInput): readonly Unresolved[] =>
  input.removals.explicit.flatMap((removal): readonly Unresolved[] => {
    const named = rowNamedBy(removal, input.knownIndex);
    switch (named.kind) {
      case "ambiguous": {
        return [{ identity: null, id: named.removal.id, reason: "unmatchedRemoval" }];
      }
      case "matched":
      case "unheldByUs": {
        return [];
      }
      default: {
        return assertNever(named);
      }
    }
  });

const rowsAbsentFrom = (input: TombstoneInput): readonly KnownEvent[] =>
  input.removals.absent.flatMap((identity) => {
    const row = input.knownIndex.byIdentity.get(sourceIdentityKey(identity));
    if (!row) {
      return [];
    }
    return [row];
  });

const outOfScopeReported = (input: TombstoneInput): readonly Unresolved[] =>
  input.removals.outOfScope.map((id) => ({
    identity: null,
    id,
    reason: "removalOutOfScope",
  }));

const deriveTombstones = (input: TombstoneInput): TombstoneDerivation => {
  if (input.known.corrupt.length > 0) {
    return { tombstones: [], unresolved: corruptRowsReported(input.known) };
  }
  const claimed = new Set<string>(input.claimedMappingKeys);
  const tombstones: Tombstone[] = [];
  const unresolved: Unresolved[] = [
    ...outOfScopeReported(input),
    ...ambiguousRemovalsReported(input),
  ];
  for (const event of input.known.events) {
    if (!retiredByTheMirrorWindow(event, input)) {
      continue;
    }
    claimed.add(sourceIdentityKey(event.identity));
    tombstones.push(tombstoneFor(event, "outsideMirrorWindow", input));
  }
  for (const event of rowsNamedBy(input)) {
    const key = sourceIdentityKey(event.identity);
    if (claimed.has(key)) {
      continue;
    }
    claimed.add(key);
    tombstones.push(tombstoneFor(event, "explicitRemoval", input));
  }
  for (const event of rowsAbsentFrom(input)) {
    const key = sourceIdentityKey(event.identity);
    if (claimed.has(key)) {
      continue;
    }
    claimed.add(key);
    if (!absenceIsProven(event, input)) {
      unresolved.push({
        identity: event.identity,
        id: null,
        reason: "outsideProvenCoverage",
      });
      continue;
    }
    tombstones.push(tombstoneFor(event, "absentFromSnapshot", input));
  }
  return { tombstones, unresolved };
};

export { deriveTombstones };
export type { TombstoneDerivation, TombstoneInput };

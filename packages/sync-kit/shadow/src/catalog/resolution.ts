import type {
  DeleteHandle,
  ObservedPrecondition,
  RemoteEvent,
  RemoteEventId,
} from "@keeper.sh/sync-protocol";
import type { KnownEvent, Mapping, SourceIdentity } from "@keeper.sh/sync-reconcile";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { ShadowInternalDataError } from "../errors";
import type { TranslationUnit } from "../translate/unit";
import type { DeleteHandleSource, EntryTime } from "./entries";
import { timeOfIdentity } from "./recurrence";

interface UnitIndexes {
  readonly mappingByIdentity: ReadonlyMap<string, Mapping>;
  readonly mirrorById: ReadonlyMap<string, RemoteEvent>;
  readonly knownByIdentity: ReadonlyMap<string, KnownEvent>;
}

interface ResolvedMirror {
  readonly remoteEventId: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly handleSource: DeleteHandleSource;
  readonly precondition: ObservedPrecondition;
}

const destinationEventsOf = (unit: TranslationUnit): readonly RemoteEvent[] => {
  if (unit.observed.kind === "sourceOnly") {
    return [];
  }
  return unit.observed.destination.events ?? [];
};

const indexesOf = (unit: TranslationUnit): UnitIndexes => ({
  mappingByIdentity: new Map(
    unit.mappings.entries.map((entry) => [sourceIdentityKey(entry.sourceIdentity), entry]),
  ),
  mirrorById: new Map(destinationEventsOf(unit).map((event) => [event.id.value, event])),
  knownByIdentity: new Map(
    unit.known.events.map((event) => [sourceIdentityKey(event.identity), event]),
  ),
});

const refuseUnmappedIdentity = (key: string): never => {
  throw new ShadowInternalDataError(
    `a planned removal names the source identity ${key}, which no mapping claims`,
  );
};

const resolvedMirrorOf = (identity: SourceIdentity, indexes: UnitIndexes): ResolvedMirror => {
  const key = sourceIdentityKey(identity);
  const mapping = indexes.mappingByIdentity.get(key);
  if (!mapping) {
    return refuseUnmappedIdentity(key);
  }
  const observed = indexes.mirrorById.get(mapping.destination.id.value);
  if (!observed) {
    return {
      remoteEventId: mapping.destination.id,
      deleteHandle: mapping.destination.deleteHandle,
      handleSource: "storedMapping",
      precondition: mapping.precondition,
    };
  }
  return {
    remoteEventId: mapping.destination.id,
    deleteHandle: observed.deleteHandle,
    handleSource: "observedListing",
    precondition: mapping.precondition,
  };
};

const removedTimeOf = (identity: SourceIdentity, indexes: UnitIndexes): EntryTime => {
  const known = indexes.knownByIdentity.get(sourceIdentityKey(identity));
  if (known) {
    return { kind: "occurrence", time: known.time };
  }
  return timeOfIdentity(identity);
};

export { destinationEventsOf, indexesOf, removedTimeOf, resolvedMirrorOf };
export type { ResolvedMirror, UnitIndexes };

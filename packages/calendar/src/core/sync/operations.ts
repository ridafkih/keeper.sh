import type { EventMapping } from "../events/mappings";
import type { RemoteEvent, SyncableEvent, SyncOperation } from "../types";
import { createSyncEventContentHash } from "../events/content-hash";
import { getOAuthSyncWindowStart } from "../oauth/sync-window";

interface RemoveOperationTimeBoundary {
  now: Date;
  syncWindowStart: Date;
}

interface StaleMappingResult {
  staleMappingIds: string[];
  staleMappedEventIds: Set<string>;
  staleRemoteMappings: EventMapping[];
}

interface ComputeSyncOperationsResult {
  operations: SyncOperation[];
  staleMappingIds: string[];
}

const getDefaultTimeBoundary = (): RemoveOperationTimeBoundary => ({
  now: new Date(),
  syncWindowStart: getOAuthSyncWindowStart(),
});

const identifyStaleMappings = (
  mappings: EventMapping[],
  localEventIds: Set<string>,
  remoteEventUids: Set<string>,
  localEventHashes: Map<string, string>,
): StaleMappingResult => {
  const staleMappingIds: string[] = [];
  const staleMappedEventIds = new Set<string>();
  const staleRemoteMappings: EventMapping[] = [];

  for (const mapping of mappings) {
    const localEventExists = localEventIds.has(mapping.eventStateId);
    const remoteEventExists = remoteEventUids.has(mapping.destinationEventUid);

    if (localEventExists && !remoteEventExists) {
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(mapping.eventStateId);
      continue;
    }

    if (!localEventExists || !remoteEventExists) {
      continue;
    }

    const localEventHash = localEventHashes.get(mapping.eventStateId);
    if (!localEventHash) {
      continue;
    }

    if (mapping.syncEventHash !== localEventHash) {
      staleMappingIds.push(mapping.id);
      staleRemoteMappings.push(mapping);
    }
  }

  return { staleMappedEventIds, staleMappingIds, staleRemoteMappings };
};

const buildAddOperations = (
  localEvents: SyncableEvent[],
  existingMappings: EventMapping[],
  staleMappedEventIds: Set<string>,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];

  for (const event of localEvents) {
    const hasMapping = existingMappings.some((mapping) => mapping.eventStateId === event.id);
    const hasStaleMapping = staleMappedEventIds.has(event.id);

    if (!hasMapping || hasStaleMapping) {
      operations.push({ event, type: "add" });
    }
  }

  return operations;
};

const buildRemoveOperationsForMappings = (mappings: EventMapping[]): SyncOperation[] =>
  mappings.map((mapping) => ({
    deleteId: mapping.deleteIdentifier,
    startTime: mapping.startTime,
    type: "remove",
    uid: mapping.destinationEventUid,
  }));

const getOperationEventTime = (operation: SyncOperation): Date => {
  if (operation.type === "add") {
    return operation.event.startTime;
  }
  return operation.startTime;
};

const getOperationTypePriority = (operation: SyncOperation): number => {
  if (operation.type === "remove") {
    return 0;
  }
  return 1;
};

const sortOperationsByTime = (operations: SyncOperation[]): SyncOperation[] =>
  operations.toSorted((first, second) => {
    const timeDiff = getOperationEventTime(first).getTime() - getOperationEventTime(second).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return getOperationTypePriority(first) - getOperationTypePriority(second);
  });

const buildRemoveOperations = (
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  localEventIds: Set<string>,
  mappedDestinationUids: Set<string>,
  timeBoundary: RemoveOperationTimeBoundary = getDefaultTimeBoundary(),
): SyncOperation[] => {
  const operations: SyncOperation[] = [];

  for (const mapping of existingMappings) {
    if (mapping.startTime < timeBoundary.syncWindowStart) {
      continue;
    }

    if (!localEventIds.has(mapping.eventStateId)) {
      operations.push({
        deleteId: mapping.deleteIdentifier,
        startTime: mapping.startTime,
        type: "remove",
        uid: mapping.destinationEventUid,
      });
    }
  }

  for (const remoteEvent of remoteEvents) {
    if (mappedDestinationUids.has(remoteEvent.uid)) {
      continue;
    }

    const isOrphanedKeeperEvent = remoteEvent.isKeeperEvent;
    const isPastEvent = remoteEvent.startTime <= timeBoundary.now;

    if (!isOrphanedKeeperEvent && !isPastEvent) {
      continue;
    }

    operations.push({
      deleteId: remoteEvent.deleteId,
      startTime: remoteEvent.startTime,
      type: "remove",
      uid: remoteEvent.uid,
    });
  }

  return operations;
};

const computeSyncOperations = (
  localEvents: SyncableEvent[],
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  timeBoundary: RemoveOperationTimeBoundary = getDefaultTimeBoundary(),
): ComputeSyncOperationsResult => {
  const localEventIds = new Set(localEvents.map((event) => event.id));
  const localEventHashes = new Map(
    localEvents.map((event) => [event.id, createSyncEventContentHash(event)]),
  );
  const remoteEventUids = new Set(remoteEvents.map((event) => event.uid));
  const mappedDestinationUids = new Set(
    existingMappings.map(({ destinationEventUid }) => destinationEventUid),
  );

  const { staleMappingIds, staleMappedEventIds, staleRemoteMappings } =
    identifyStaleMappings(existingMappings, localEventIds, remoteEventUids, localEventHashes);

  const addOperations = buildAddOperations(localEvents, existingMappings, staleMappedEventIds);

  const hasNoLocalEvents = localEvents.length === 0;
  const hasNoMappings = existingMappings.length === 0;
  const shouldSkipRemoteCleanup = hasNoLocalEvents && hasNoMappings;

  let removeOperations: SyncOperation[] = [];
  if (!shouldSkipRemoteCleanup) {
    removeOperations = buildRemoveOperations(
      existingMappings,
      remoteEvents,
      localEventIds,
      mappedDestinationUids,
      timeBoundary,
    );
  }

  const staleMappingRemoveOperations = buildRemoveOperationsForMappings(staleRemoteMappings);

  return {
    operations: sortOperationsByTime([
      ...addOperations,
      ...removeOperations,
      ...staleMappingRemoveOperations,
    ]),
    staleMappingIds,
  };
};

export {
  buildAddOperations,
  buildRemoveOperations,
  buildRemoveOperationsForMappings,
  computeSyncOperations,
  identifyStaleMappings,
};
export type { ComputeSyncOperationsResult, RemoveOperationTimeBoundary, StaleMappingResult };

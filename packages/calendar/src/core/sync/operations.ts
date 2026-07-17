import type { EventMapping } from "../events/mappings";
import type { RemoteEvent, SyncableEvent, SyncOperation } from "../types";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../events/content-hash";
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
  mappingIdsToPrune: string[];
  operations: SyncOperation[];
  staleMappingIds: string[];
}

const getDefaultTimeBoundary = (): RemoveOperationTimeBoundary => ({
  now: new Date(),
  syncWindowStart: getOAuthSyncWindowStart(),
});

const getMappingSyncEventId = (mapping: EventMapping): string =>
  mapping.syncEventId ?? mapping.eventStateId;

const isSameSerializedSecond = (first: Date, second: Date): boolean =>
  Math.trunc(first.getTime() / 1000) === Math.trunc(second.getTime() / 1000);

const hasRemoteStateChanged = (
  mapping: EventMapping,
  localEvent: SyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const remoteContentChanged = typeof remoteEvent.editableContentHash === "string"
    && remoteEvent.editableContentHash !== createEditableEventContentHash(localEvent);
  const localAvailability = localEvent.availability ?? "busy";
  const supportedAvailabilities = remoteEvent.supportedAvailabilities ?? [];
  let expectedRemoteAvailability: SyncableEvent["availability"] = "busy";
  if (supportedAvailabilities.includes(localAvailability)) {
    expectedRemoteAvailability = localAvailability;
  }
  const remoteAvailabilityChanged = typeof remoteEvent.editableAvailability === "string"
    && remoteEvent.editableAvailability !== expectedRemoteAvailability;
  const remoteTimeChanged = !isSameSerializedSecond(remoteEvent.startTime, mapping.startTime)
    || !isSameSerializedSecond(remoteEvent.endTime, mapping.endTime);

  return remoteAvailabilityChanged || remoteContentChanged || remoteTimeChanged;
};

const identifyStaleMappings = (
  mappings: EventMapping[],
  localEventIds: Set<string>,
  remoteEventsByIdentity: Map<string, RemoteEvent>,
  localEventsById: Map<string, SyncableEvent>,
): StaleMappingResult => {
  const staleMappingIds: string[] = [];
  const staleMappedEventIds = new Set<string>();
  const staleRemoteMappings: EventMapping[] = [];

  for (const mapping of mappings) {
    const syncEventId = getMappingSyncEventId(mapping);
    const localEventExists = localEventIds.has(syncEventId);
    const remoteEvent = remoteEventsByIdentity.get(
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`,
    );
    if (localEventExists && !remoteEvent) {
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(syncEventId);
      continue;
    }

    if (!localEventExists || !remoteEvent) {
      continue;
    }

    const localEvent = localEventsById.get(syncEventId);
    if (!localEvent) {
      continue;
    }

    const localEventHash = createSyncEventContentHash(localEvent);
    const eventContentChanged = mapping.syncEventHash !== localEventHash;

    if (eventContentChanged || hasRemoteStateChanged(mapping, localEvent, remoteEvent)) {
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(syncEventId);
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
    const existingMapping = existingMappings.find(
      (mapping) => getMappingSyncEventId(mapping) === event.id,
    );
    const hasMapping = Boolean(existingMapping);
    const hasStaleMapping = staleMappedEventIds.has(event.id);

    if (!hasMapping || hasStaleMapping) {
      operations.push({
        event,
        type: "add",
        ...(hasStaleMapping && existingMapping && { staleMappingId: existingMapping.id }),
      });
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

const buildReplacementOperations = (
  mappings: EventMapping[],
  localEventsById: Map<string, SyncableEvent>,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];
  for (const mapping of mappings) {
    const event = localEventsById.get(getMappingSyncEventId(mapping));
    if (!event) {
      continue;
    }
    operations.push({
      deleteId: mapping.deleteIdentifier,
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    });
  }
  return operations;
};

const getOperationEventTime = (operation: SyncOperation): Date => {
  if (operation.type === "add" || operation.type === "replace") {
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
  mappedRemoteIdentities: Set<string>,
  timeBoundary: RemoveOperationTimeBoundary = getDefaultTimeBoundary(),
): SyncOperation[] => {
  const operations: SyncOperation[] = [];

  for (const mapping of existingMappings) {
    if (mapping.startTime < timeBoundary.syncWindowStart) {
      continue;
    }

    if (!localEventIds.has(getMappingSyncEventId(mapping))) {
      operations.push({
        deleteId: mapping.deleteIdentifier,
        startTime: mapping.startTime,
        type: "remove",
        uid: mapping.destinationEventUid,
      });
    }
  }

  for (const remoteEvent of remoteEvents) {
    if (mappedRemoteIdentities.has(`${remoteEvent.uid}\u0000${remoteEvent.deleteId}`)) {
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
  const localEventsById = new Map(localEvents.map((event) => [event.id, event]));
  const remoteEventsByIdentity = new Map(
    remoteEvents.map((event) => [`${event.uid}\u0000${event.deleteId}`, event]),
  );
  const mappedRemoteIdentities = new Set(
    existingMappings.map((mapping) =>
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`),
  );
  const mappingIdsToPrune = existingMappings.flatMap((mapping) => {
    if (localEventIds.has(getMappingSyncEventId(mapping))) {
      return [];
    }
    const remoteExists = remoteEventsByIdentity.has(
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`,
    );
    if (mapping.startTime < timeBoundary.syncWindowStart || !remoteExists) {
      return [mapping.id];
    }
    return [];
  });

  const { staleMappingIds, staleMappedEventIds, staleRemoteMappings } =
    identifyStaleMappings(existingMappings, localEventIds, remoteEventsByIdentity, localEventsById);

  const replacedEventIds = new Set(
    staleRemoteMappings.map((mapping) => getMappingSyncEventId(mapping)),
  );
  const addOperations = buildAddOperations(localEvents, existingMappings, staleMappedEventIds)
    .filter((operation) => operation.type !== "add" || !replacedEventIds.has(operation.event.id));
  const replacementOperations = buildReplacementOperations(staleRemoteMappings, localEventsById);

  const removeOperations = buildRemoveOperations(
    existingMappings,
    remoteEvents,
    localEventIds,
    mappedRemoteIdentities,
    timeBoundary,
  );

  return {
    mappingIdsToPrune,
    operations: sortOperationsByTime([
      ...addOperations,
      ...removeOperations,
      ...replacementOperations,
    ]),
    staleMappingIds,
  };
};

export {
  buildAddOperations,
  buildRemoveOperations,
  buildRemoveOperationsForMappings,
  buildReplacementOperations,
  computeSyncOperations,
  identifyStaleMappings,
};
export type { ComputeSyncOperationsResult, RemoveOperationTimeBoundary, StaleMappingResult };

import type { EventMapping } from "../events/mappings";
import type {
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "../types";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../events/content-hash";
import { getOAuthSyncWindowStart } from "../oauth/sync-window";

interface RemoveOperationTimeBoundary {
  syncWindowStart: Date;
}

interface StaleMappingResult {
  staleMappingIds: string[];
  staleMappedEventIds: Set<string>;
  staleRemoteMappings: EventMapping[];
}

interface ComputeSyncOperationsResult {
  mappingUpdates: MappingUpdate[];
  mappingIdsToPrune: string[];
  operations: SyncOperation[];
  staleMappingIds: string[];
}

interface MappingUpdate {
  deleteIdentifier: string;
  id: string;
  syncEventHash: string;
  syncEventId: string;
}

interface OccurrenceReassignment {
  event: MaterializedSyncableEvent;
  mapping: EventMapping;
}

const getDefaultTimeBoundary = (): RemoveOperationTimeBoundary => ({
  syncWindowStart: getOAuthSyncWindowStart(),
});

const getMappingSyncEventId = (mapping: EventMapping): string =>
  mapping.syncEventId ?? mapping.eventStateId;

const compareMappingSlots = (first: EventMapping, second: EventMapping): number =>
  first.startTime.getTime() - second.startTime.getTime()
  || first.endTime.getTime() - second.endTime.getTime()
  || first.id.localeCompare(second.id);

const compareEventSlots = (
  first: MaterializedSyncableEvent,
  second: MaterializedSyncableEvent,
): number => first.startTime.getTime() - second.startTime.getTime()
  || first.endTime.getTime() - second.endTime.getTime()
  || first.id.localeCompare(second.id);

const getSerializedSlotKey = (startTime: Date, endTime: Date): string =>
  `${Math.trunc(startTime.getTime() / 1000)}\u0000${Math.trunc(endTime.getTime() / 1000)}`;

const pairReidentifiedMaterializedOccurrences = (
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
): OccurrenceReassignment[] => {
  const localEventIds = new Set(localEvents.map((event) => event.id));
  const mappedEventIds = new Set(existingMappings.map((mapping) => getMappingSyncEventId(mapping)));
  const newEventsByOwner = new Map<string, MaterializedSyncableEvent[]>();
  const missingMappingsByOwner = new Map<string, EventMapping[]>();

  for (const event of localEvents) {
    if (!event.eventStateId || mappedEventIds.has(event.id)) {
      continue;
    }
    const events = newEventsByOwner.get(event.eventStateId) ?? [];
    events.push(event);
    newEventsByOwner.set(event.eventStateId, events);
  }

  for (const mapping of existingMappings) {
    if (localEventIds.has(getMappingSyncEventId(mapping))) {
      continue;
    }
    const mappings = missingMappingsByOwner.get(mapping.eventStateId) ?? [];
    mappings.push(mapping);
    missingMappingsByOwner.set(mapping.eventStateId, mappings);
  }

  const reassignments: OccurrenceReassignment[] = [];
  for (const [ownerId, events] of newEventsByOwner) {
    const mappings = missingMappingsByOwner.get(ownerId);
    if (!mappings) {
      continue;
    }
    const orderedEvents = events.toSorted(compareEventSlots);
    const orderedMappings = mappings.toSorted(compareMappingSlots);
    const mappingsBySlot = new Map<string, EventMapping[]>();
    for (const mapping of orderedMappings) {
      const slotKey = getSerializedSlotKey(mapping.startTime, mapping.endTime);
      const slotMappings = mappingsBySlot.get(slotKey) ?? [];
      slotMappings.push(mapping);
      mappingsBySlot.set(slotKey, slotMappings);
    }

    const pairedEventIds = new Set<string>();
    const pairedMappingIds = new Set<string>();
    for (const event of orderedEvents) {
      const slotMappings = mappingsBySlot.get(getSerializedSlotKey(
        event.startTime,
        event.endTime,
      ));
      const mapping = slotMappings?.shift();
      if (!mapping) {
        continue;
      }
      reassignments.push({ event, mapping });
      pairedEventIds.add(event.id);
      pairedMappingIds.add(mapping.id);
    }

    const remainingEvents = orderedEvents.filter((event) => !pairedEventIds.has(event.id));
    const remainingMappings = orderedMappings.filter(
      (mapping) => !pairedMappingIds.has(mapping.id),
    );
    const pairCount = Math.min(remainingEvents.length, remainingMappings.length);
    for (let index = 0; index < pairCount; index++) {
      const event = remainingEvents[index];
      const mapping = remainingMappings[index];
      if (event && mapping) {
        reassignments.push({ event, mapping });
      }
    }
  }

  return reassignments;
};

const isSameSerializedSecond = (first: Date, second: Date): boolean =>
  Math.trunc(first.getTime() / 1000) === Math.trunc(second.getTime() / 1000);

const getRemoteIdentity = (uid: string, deleteId: string): string =>
  `${uid}\u0000${deleteId}`;

const matchRemoteEventsToMappings = (
  mappings: EventMapping[],
  remoteEvents: RemoteEvent[],
): Map<string, RemoteEvent> => {
  const remoteEventsByIdentity = new Map(
    remoteEvents.map((event) => [getRemoteIdentity(event.uid, event.deleteId), event]),
  );
  const remoteEventsByUid = new Map<string, RemoteEvent[]>();
  for (const remoteEvent of remoteEvents) {
    const matchingUidEvents = remoteEventsByUid.get(remoteEvent.uid) ?? [];
    matchingUidEvents.push(remoteEvent);
    remoteEventsByUid.set(remoteEvent.uid, matchingUidEvents);
  }

  const matches = new Map<string, RemoteEvent>();
  for (const mapping of mappings) {
    const exactMatch = remoteEventsByIdentity.get(getRemoteIdentity(
      mapping.destinationEventUid,
      mapping.deleteIdentifier,
    ));
    if (exactMatch) {
      matches.set(mapping.id, exactMatch);
      continue;
    }

    if (mapping.deleteIdentifier !== mapping.destinationEventUid) {
      continue;
    }
    const legacyUidMatches = remoteEventsByUid.get(mapping.destinationEventUid) ?? [];
    if (legacyUidMatches.length === 1 && legacyUidMatches[0]) {
      matches.set(mapping.id, legacyUidMatches[0]);
    }
  }

  return matches;
};

const hasRemoteStateChanged = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): boolean => {
  const remoteContentChanged = typeof remoteEvent.editableContentHash === "string"
    && remoteEvent.editableContentHash !== createEditableEventContentHash(localEvent);
  const localAvailability = localEvent.availability ?? "busy";
  const supportedAvailabilities = remoteEvent.supportedAvailabilities ?? [];
  let expectedRemoteAvailability: MaterializedSyncableEvent["availability"] = "busy";
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
  remoteEventsByMappingId: Map<string, RemoteEvent>,
  localEventsById: Map<string, MaterializedSyncableEvent>,
): StaleMappingResult => {
  const staleMappingIds: string[] = [];
  const staleMappedEventIds = new Set<string>();
  const staleRemoteMappings: EventMapping[] = [];

  for (const mapping of mappings) {
    const syncEventId = getMappingSyncEventId(mapping);
    const localEventExists = localEventIds.has(syncEventId);
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    if (localEventExists && !remoteEvent) {
      staleMappingIds.push(mapping.id);
      staleMappedEventIds.add(syncEventId);
      staleRemoteMappings.push(mapping);
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
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
  staleMappedEventIds: Set<string>,
): SyncOperation[] => {
  const operations: SyncOperation[] = [];
  const mappingsBySyncEventId = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    const syncEventId = getMappingSyncEventId(mapping);
    if (!mappingsBySyncEventId.has(syncEventId)) {
      mappingsBySyncEventId.set(syncEventId, mapping);
    }
  }

  for (const event of localEvents) {
    const existingMapping = mappingsBySyncEventId.get(event.id);
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
  localEventsById: Map<string, MaterializedSyncableEvent>,
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
  const remoteIdentities = new Set(
    remoteEvents.map((remoteEvent) => `${remoteEvent.uid}\u0000${remoteEvent.deleteId}`),
  );

  for (const mapping of existingMappings) {
    const remoteIdentity = `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`;
    if (
      mapping.endTime < timeBoundary.syncWindowStart
      && !remoteIdentities.has(remoteIdentity)
      && mapping.deleteIdentifier !== mapping.destinationEventUid
    ) {
      continue;
    }
    if (
      !localEventIds.has(getMappingSyncEventId(mapping))
    ) {
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

    if (!remoteEvent.isKeeperEvent) {
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
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  timeBoundary: RemoveOperationTimeBoundary = getDefaultTimeBoundary(),
): ComputeSyncOperationsResult => {
  const localEventIds = new Set(localEvents.map((event) => event.id));
  const localEventsById = new Map(localEvents.map((event) => [event.id, event]));
  const remoteEventsByMappingId = matchRemoteEventsToMappings(existingMappings, remoteEvents);
  const mappingIdsToPrune = existingMappings.flatMap((mapping) => {
    if (localEventIds.has(getMappingSyncEventId(mapping))) {
      return [];
    }
    const remoteExists = remoteEventsByMappingId.has(mapping.id);
    if (mapping.endTime < timeBoundary.syncWindowStart && !remoteExists) {
      return [mapping.id];
    }
    return [];
  });
  const mappingIdsToPruneSet = new Set(mappingIdsToPrune);
  const activeMappings = existingMappings.filter(
    (mapping) => !mappingIdsToPruneSet.has(mapping.id),
  );
  const occurrenceReassignments = pairReidentifiedMaterializedOccurrences(
    localEvents,
    activeMappings,
  );
  const databaseOnlyReassignments: OccurrenceReassignment[] = [];
  const remoteReassignments: OccurrenceReassignment[] = [];
  for (const reassignment of occurrenceReassignments) {
    const { event, mapping } = reassignment;
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    const mappingMatchesOccurrence = isSameSerializedSecond(mapping.startTime, event.startTime)
      && isSameSerializedSecond(mapping.endTime, event.endTime);
    const remoteStateIsVerifiable = typeof remoteEvent?.editableAvailability === "string"
      && typeof remoteEvent.editableContentHash === "string";
    if (
      remoteEvent
      && remoteStateIsVerifiable
      && mappingMatchesOccurrence
      && !hasRemoteStateChanged(mapping, event, remoteEvent)
    ) {
      databaseOnlyReassignments.push(reassignment);
    } else {
      remoteReassignments.push(reassignment);
    }
  }
  const reassignedMappingIds = new Set(
    occurrenceReassignments.map(({ mapping }) => mapping.id),
  );
  const reassignedEventIds = new Set(
    occurrenceReassignments.map(({ event }) => event.id),
  );
  const standardMappings = activeMappings.filter(
    (mapping) => !reassignedMappingIds.has(mapping.id),
  );
  const mappedRemoteIdentities = new Set(
    [...remoteEventsByMappingId.values()].map((remoteEvent) =>
      getRemoteIdentity(remoteEvent.uid, remoteEvent.deleteId)),
  );

  const { staleMappingIds, staleMappedEventIds, staleRemoteMappings } =
    identifyStaleMappings(
      standardMappings,
      localEventIds,
      remoteEventsByMappingId,
      localEventsById,
    );
  const staleMappingIdSet = new Set(staleMappingIds);
  const mappingUpdatesById = new Map<string, MappingUpdate>();
  for (const mapping of standardMappings) {
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    const localEvent = localEventsById.get(getMappingSyncEventId(mapping));
    if (
      !staleMappingIdSet.has(mapping.id)
      && localEvent
      && remoteEvent
      && mapping.deleteIdentifier === mapping.destinationEventUid
      && remoteEvent.deleteId !== mapping.deleteIdentifier
    ) {
      mappingUpdatesById.set(mapping.id, {
        deleteIdentifier: remoteEvent.deleteId,
        id: mapping.id,
        syncEventHash: createSyncEventContentHash(localEvent),
        syncEventId: localEvent.id,
      });
    }
  }
  for (const { event, mapping } of databaseOnlyReassignments) {
    const remoteEvent = remoteEventsByMappingId.get(mapping.id);
    if (!remoteEvent) {
      continue;
    }
    mappingUpdatesById.set(mapping.id, {
      deleteIdentifier: remoteEvent.deleteId,
      id: mapping.id,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    });
  }

  const replacedEventIds = new Set(
    staleRemoteMappings.map((mapping) => getMappingSyncEventId(mapping)),
  );
  const addOperations = buildAddOperations(localEvents, existingMappings, staleMappedEventIds)
    .filter((operation) => operation.type !== "add"
      || !replacedEventIds.has(operation.event.id)
        && !reassignedEventIds.has(operation.event.id));
  const replacementOperations = buildReplacementOperations(staleRemoteMappings, localEventsById);
  const reassignmentOperations: SyncOperation[] = remoteReassignments.map(({
    event,
    mapping,
  }) => ({
    deleteId: mapping.deleteIdentifier,
    event,
    staleMappingId: mapping.id,
    type: "replace",
    uid: mapping.destinationEventUid,
  }));

  const removeOperations = buildRemoveOperations(
    standardMappings,
    remoteEvents,
    localEventIds,
    mappedRemoteIdentities,
    timeBoundary,
  );

  return {
    mappingUpdates: [...mappingUpdatesById.values()],
    mappingIdsToPrune,
    operations: sortOperationsByTime([
      ...addOperations,
      ...removeOperations,
      ...replacementOperations,
      ...reassignmentOperations,
    ]),
    staleMappingIds: [
      ...staleMappingIds,
      ...remoteReassignments.map(({ mapping }) => mapping.id),
    ],
  };
};

export {
  buildAddOperations,
  buildRemoveOperations,
  buildRemoveOperationsForMappings,
  buildReplacementOperations,
  computeSyncOperations,
  identifyStaleMappings,
  matchRemoteEventsToMappings,
  pairReidentifiedMaterializedOccurrences,
};
export type {
  ComputeSyncOperationsResult,
  MappingUpdate,
  OccurrenceReassignment,
  RemoveOperationTimeBoundary,
  StaleMappingResult,
};

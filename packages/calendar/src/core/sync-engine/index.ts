import type { SyncResult, SyncOperation, SyncableEvent, RemoteEvent, PushResult, DeleteResult } from "../types";
import type { EventMapping } from "../events/mappings";
import { computeSyncOperations } from "../sync/operations";
import type { CalendarSyncProvider, PendingChanges } from "./types";

const processAddResults = (
  addOperations: Extract<SyncOperation, { type: "add" }>[],
  pushResults: PushResult[],
  calendarId: string,
): { changes: PendingChanges; added: number; addFailed: number } => {
  const changes: PendingChanges = { inserts: [], deletes: [] };
  let added = 0;
  let addFailed = 0;

  for (let index = 0; index < addOperations.length; index++) {
    const operation = addOperations[index];
    const pushResult = pushResults[index];

    if (!operation || !pushResult?.success) {
      addFailed += 1;
      continue;
    }

    if (!pushResult.remoteId) {
      continue;
    }

    added += 1;
    changes.inserts.push({
      eventStateId: operation.event.id,
      calendarId,
      destinationEventUid: pushResult.remoteId,
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId,
      syncEventHash: null,
      startTime: operation.event.startTime,
      endTime: operation.event.endTime,
    });
  }

  return { changes, added, addFailed };
};

const processDeleteResults = (
  removeOperations: Extract<SyncOperation, { type: "remove" }>[],
  deleteResults: DeleteResult[],
  mappingsByDestinationUid: Map<string, EventMapping>,
): { deleteIds: string[]; removed: number; removeFailed: number } => {
  const deleteIds: string[] = [];
  let removed = 0;
  let removeFailed = 0;

  for (let index = 0; index < removeOperations.length; index++) {
    const operation = removeOperations[index];
    const deleteResult = deleteResults[index];

    if (!operation || !deleteResult?.success) {
      removeFailed += 1;
      continue;
    }

    removed += 1;
    const mapping = mappingsByDestinationUid.get(operation.uid);
    if (mapping) {
      deleteIds.push(mapping.id);
    }
  }

  return { deleteIds, removed, removeFailed };
};

const executeRemoteOperations = async (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
  calendarId: string,
  provider: CalendarSyncProvider,
  isCurrent?: () => Promise<boolean>,
): Promise<{ changes: PendingChanges; result: SyncResult } | null> => {
  if (isCurrent) {
    const stillCurrent = await isCurrent();
    if (!stillCurrent) {
      return null;
    }
  }

  const mappingsByDestinationUid = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByDestinationUid.set(mapping.destinationEventUid, mapping);
  }

  const addOperations: Extract<SyncOperation, { type: "add" }>[] = [];
  const removeOperations: Extract<SyncOperation, { type: "remove" }>[] = [];

  for (const operation of operations) {
    if (operation.type === "add") {
      addOperations.push(operation);
    } else if (operation.type === "remove") {
      removeOperations.push(operation);
    }
  }

  const changes: PendingChanges = { inserts: [], deletes: [] };
  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;

  if (addOperations.length > 0) {
    const addEvents = addOperations.map((op) => op.event);
    const pushResults = await provider.pushEvents(addEvents);
    const { added: addedCount, addFailed: addFailedCount, changes: addChanges } = processAddResults(addOperations, pushResults, calendarId);

    added = addedCount;
    addFailed = addFailedCount;
    changes.inserts.push(...addChanges.inserts);
  }

  if (removeOperations.length > 0) {
    if (isCurrent) {
      const stillCurrent = await isCurrent();
      if (!stillCurrent) {
        return null;
      }
    }

    const idsToDelete = removeOperations.map((op) => op.deleteId);
    const deleteResults = await provider.deleteEvents(idsToDelete);
    const { removed: removedCount, removeFailed: removeFailedCount, deleteIds: deletedMappingIds } = processDeleteResults(removeOperations, deleteResults, mappingsByDestinationUid);

    removed = removedCount;
    removeFailed = removeFailedCount;
    changes.deletes.push(...deletedMappingIds);
  }

  return { changes, result: { added, addFailed, removed, removeFailed } };
};

interface SyncCalendarOptions {
  calendarId: string;
  provider: CalendarSyncProvider;
  readState: () => Promise<{
    localEvents: SyncableEvent[];
    existingMappings: EventMapping[];
    remoteEvents: RemoteEvent[];
  }>;
  isCurrent: () => Promise<boolean>;
  flush: (changes: PendingChanges) => Promise<void>;
  onSyncEvent?: (event: Record<string, unknown>) => void;
}

const EMPTY_RESULT: SyncResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncResult> => {
  const { calendarId, provider, readState, isCurrent, flush, onSyncEvent } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "sync:calendar",
    "operation.type": "sync",
  };

  const startTime = Date.now();
  let flushed = false;

  try {
    const state = await readState();

    wideEvent["local_events.count"] = state.localEvents.length;
    wideEvent["existing_mappings.count"] = state.existingMappings.length;
    wideEvent["remote_events.count"] = state.remoteEvents.length;

    const stillCurrent = await isCurrent();
    if (!stillCurrent) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    const { operations, staleMappingIds } = computeSyncOperations(
      state.localEvents,
      state.existingMappings,
      state.remoteEvents,
    );

    const addCount = operations.filter((op) => op.type === "add").length;
    const removeCount = operations.filter((op) => op.type === "remove").length;

    wideEvent["operations.add_count"] = addCount;
    wideEvent["operations.remove_count"] = removeCount;
    wideEvent["operations.total"] = operations.length;
    wideEvent["stale_mappings.count"] = staleMappingIds.length;

    if (operations.length === 0 && staleMappingIds.length === 0) {
      wideEvent["outcome"] = "in-sync";
      wideEvent["flushed"] = false;
      wideEvent["events.added"] = 0;
      wideEvent["events.add_failed"] = 0;
      wideEvent["events.removed"] = 0;
      wideEvent["events.remove_failed"] = 0;
      return EMPTY_RESULT;
    }

    const outcome = await executeRemoteOperations(
      operations,
      state.existingMappings,
      calendarId,
      provider,
      isCurrent,
    );

    if (outcome === null) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    wideEvent["events.added"] = outcome.result.added;
    wideEvent["events.add_failed"] = outcome.result.addFailed;
    wideEvent["events.removed"] = outcome.result.removed;
    wideEvent["events.remove_failed"] = outcome.result.removeFailed;

    outcome.changes.deletes.push(...staleMappingIds);

    const canFlush = await isCurrent();
    if (!canFlush) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return outcome.result;
    }

    await flush(outcome.changes);
    flushed = true;

    wideEvent["outcome"] = "success";
    wideEvent["flushed"] = true;
    wideEvent["flush.inserts"] = outcome.changes.inserts.length;
    wideEvent["flush.deletes"] = outcome.changes.deletes.length;

    return outcome.result;
  } catch (error) {
    wideEvent["outcome"] = "error";
    wideEvent["flushed"] = flushed;

    if (error instanceof Error) {
      wideEvent["error.message"] = error.message;
      wideEvent["error.type"] = error.constructor.name;
    }

    throw error;
  } finally {
    wideEvent["duration_ms"] = Date.now() - startTime;
    onSyncEvent?.(wideEvent);
  }
};

export { executeRemoteOperations, syncCalendar };
export type { CalendarSyncProvider, PendingChanges, SyncCalendarOptions };

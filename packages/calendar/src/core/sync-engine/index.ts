import type { SyncResult, SyncOperation, SyncableEvent, RemoteEvent } from "../types";
import type { EventMapping } from "../events/mappings";
import { computeSyncOperations } from "../sync/operations";
import type { CalendarSyncProvider, PendingChanges, PendingInsert } from "./types";

const processAddOperation = async (
  operation: Extract<SyncOperation, { type: "add" }>,
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<{ success: boolean; skipped: boolean; insert: PendingInsert | null }> => {
  const [pushResult] = await provider.pushEvents([operation.event]);

  if (!pushResult?.success) {
    return { success: false, skipped: false, insert: null };
  }

  if (!pushResult.remoteId) {
    return { success: true, skipped: true, insert: null };
  }

  return {
    success: true,
    skipped: false,
    insert: {
      eventStateId: operation.event.id,
      calendarId,
      destinationEventUid: pushResult.remoteId,
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId,
      syncEventHash: null,
      startTime: operation.event.startTime,
      endTime: operation.event.endTime,
    },
  };
};

const processRemoveOperation = async (
  operation: Extract<SyncOperation, { type: "remove" }>,
  existingMappings: EventMapping[],
  provider: CalendarSyncProvider,
): Promise<{ success: boolean; mappingId: string | null }> => {
  const [deleteResult] = await provider.deleteEvents([operation.deleteId]);

  if (!deleteResult?.success) {
    return { success: false, mappingId: null };
  }

  const mapping = existingMappings.find(
    (existingMapping) => existingMapping.destinationEventUid === operation.uid,
  );

  return { success: true, mappingId: mapping?.id ?? null };
};

const executeRemoteOperations = async (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
  calendarId: string,
  provider: CalendarSyncProvider,
  isCurrent?: () => Promise<boolean>,
): Promise<{ changes: PendingChanges; result: SyncResult } | null> => {
  const changes: PendingChanges = { inserts: [], deletes: [] };
  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;

  for (const operation of operations) {
    if (isCurrent) {
      const stillCurrent = await isCurrent();
      if (!stillCurrent) {
        return null;
      }
    }

    switch (operation.type) {
      case "add": {
        const outcome = await processAddOperation(operation, calendarId, provider);
        if (outcome.skipped) {
          break;
        }
        if (outcome.success && outcome.insert) {
          added += 1;
          changes.inserts.push(outcome.insert);
        } else {
          addFailed += 1;
        }
        break;
      }
      case "remove": {
        const outcome = await processRemoveOperation(operation, existingMappings, provider);
        if (outcome.success) {
          removed += 1;
          if (outcome.mappingId) {
            changes.deletes.push(outcome.mappingId);
          }
        } else {
          removeFailed += 1;
        }
        break;
      }
      default: {
        break;
      }
    }
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
      return EMPTY_RESULT;
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

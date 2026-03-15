import type { SyncResult, EventMapping, SyncOperation, SyncableEvent, RemoteEvent } from "@keeper.sh/calendar";
import { computeSyncOperations } from "@keeper.sh/calendar";
import type { CalendarSyncProvider, PendingChanges, PendingInsert } from "./types";

const processAddOperation = async (
  operation: Extract<SyncOperation, { type: "add" }>,
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<{ success: boolean; insert: PendingInsert | null }> => {
  const [pushResult] = await provider.pushEvents([operation.event]);

  if (!pushResult?.success || !pushResult.remoteId) {
    return { success: false, insert: null };
  }

  return {
    success: true,
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
}

const EMPTY_RESULT: SyncResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncResult> => {
  const { calendarId, provider, readState, isCurrent, flush } = options;

  const state = await readState();

  const stillCurrent = await isCurrent();
  if (!stillCurrent) {
    return EMPTY_RESULT;
  }

  const { operations, staleMappingIds } = computeSyncOperations(
    state.localEvents,
    state.existingMappings,
    state.remoteEvents,
  );

  if (operations.length === 0 && staleMappingIds.length === 0) {
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
    return EMPTY_RESULT;
  }

  outcome.changes.deletes.push(...staleMappingIds);

  const canFlush = await isCurrent();
  if (!canFlush) {
    return EMPTY_RESULT;
  }

  await flush(outcome.changes);

  return outcome.result;
};

export { executeRemoteOperations, syncCalendar };
export type { CalendarSyncProvider, PendingChanges, SyncCalendarOptions };

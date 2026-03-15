import type { SyncResult, PushResult, DeleteResult, EventMapping, SyncOperation } from "@keeper.sh/calendar";
import type { CalendarSyncProvider, PendingChanges } from "./types";

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

    if (operation.type === "add") {
      const [pushResult] = await provider.pushEvents([operation.event]);
      if (pushResult?.success && pushResult.remoteId) {
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
      } else {
        addFailed += 1;
      }
    }

    if (operation.type === "remove") {
      const [deleteResult] = await provider.deleteEvents([operation.deleteId]);
      if (deleteResult?.success) {
        removed += 1;
        const mapping = existingMappings.find(
          (existingMapping) => existingMapping.destinationEventUid === operation.uid,
        );
        if (mapping) {
          changes.deletes.push(mapping.id);
        }
      } else {
        removeFailed += 1;
      }
    }
  }

  return { changes, result: { added, addFailed, removed, removeFailed } };
};

export { executeRemoteOperations };
export type { CalendarSyncProvider, PendingChanges };

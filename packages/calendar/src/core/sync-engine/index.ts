import type { SyncResult, SyncOperation, SyncableEvent, RemoteEvent, PushResult, DeleteResult } from "../types";
import type { EventMapping } from "../events/mappings";
import type { SyncProgressUpdate } from "../sync/types";
import { createSyncEventContentHash } from "../events/content-hash";
import { computeSyncOperations } from "../sync/operations";
import type { CalendarSyncProvider, PendingChanges } from "./types";

const resolveOutcome = (superseded: boolean, invalidated: boolean): string => {
  if (invalidated) {
    return "invalidated";
  }
  if (superseded) {
    return "superseded";
  }
  return "success";
};

interface OperationError {
  type: "add" | "remove";
  error: string;
  statusCode?: number;
}

const processAddResults = (
  addOperations: Extract<SyncOperation, { type: "add" }>[],
  pushResults: PushResult[],
  calendarId: string,
): { changes: PendingChanges; added: number; addFailed: number; errors: OperationError[] } => {
  const changes: PendingChanges = { inserts: [], deletes: [] };
  const errors: OperationError[] = [];
  let added = 0;
  let addFailed = 0;

  for (let index = 0; index < addOperations.length; index++) {
    const operation = addOperations[index];
    const pushResult = pushResults[index];

    if (!operation || !pushResult?.success) {
      addFailed += 1;
      if (pushResult?.error) {
        errors.push({ type: "add", error: pushResult.error });
      }
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
      syncEventHash: createSyncEventContentHash(operation.event),
      startTime: operation.event.startTime,
      endTime: operation.event.endTime,
    });
  }

  return { changes, added, addFailed, errors };
};

const processDeleteResults = (
  removeOperations: Extract<SyncOperation, { type: "remove" }>[],
  deleteResults: DeleteResult[],
  mappingsByDestinationUid: Map<string, EventMapping>,
): { deleteIds: string[]; removed: number; removeFailed: number; errors: OperationError[] } => {
  const deleteIds: string[] = [];
  const errors: OperationError[] = [];
  let removed = 0;
  let removeFailed = 0;

  for (let index = 0; index < removeOperations.length; index++) {
    const operation = removeOperations[index];
    const deleteResult = deleteResults[index];

    if (!operation || !deleteResult?.success) {
      removeFailed += 1;
      if (deleteResult?.error) {
        errors.push({ type: "remove", error: deleteResult.error });
      }
      continue;
    }

    removed += 1;
    const mapping = mappingsByDestinationUid.get(operation.uid);
    if (mapping) {
      deleteIds.push(mapping.id);
    }
  }

  return { deleteIds, removed, removeFailed, errors };
};

interface ExecuteRemoteResult {
  changes: PendingChanges;
  result: SyncResult;
  errors: OperationError[];
  superseded: boolean;
}

interface OperationRun {
  type: "add" | "remove";
  adds: Extract<SyncOperation, { type: "add" }>[];
  removes: Extract<SyncOperation, { type: "remove" }>[];
}

const groupOperationRuns = (operations: SyncOperation[]): OperationRun[] => {
  const runs: OperationRun[] = [];
  let currentRun: OperationRun | null = null;

  for (const operation of operations) {
    if (!currentRun || currentRun.type !== operation.type) {
      currentRun = { type: operation.type, adds: [], removes: [] };
      runs.push(currentRun);
    }

    if (operation.type === "add") {
      currentRun.adds.push(operation);
    } else {
      currentRun.removes.push(operation);
    }
  }

  return runs;
};

interface RunResult {
  changes: PendingChanges;
  result: SyncResult;
  errors: OperationError[];
}

const executeAddRun = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<RunResult> => {
  const addEvents = adds.map((op) => op.event);
  const pushResults = await provider.pushEvents(addEvents);
  const { added, addFailed, changes, errors } = processAddResults(adds, pushResults, calendarId);
  return {
    changes,
    result: { added, addFailed, removed: 0, removeFailed: 0 },
    errors,
  };
};

const executeRemoveRun = async (
  removes: Extract<SyncOperation, { type: "remove" }>[],
  provider: CalendarSyncProvider,
  mappingsByDestinationUid: Map<string, EventMapping>,
): Promise<RunResult> => {
  const idsToDelete = removes.map((op) => op.deleteId);
  const deleteResults = await provider.deleteEvents(idsToDelete);
  const { removed, removeFailed, deleteIds, errors } = processDeleteResults(removes, deleteResults, mappingsByDestinationUid);
  return {
    changes: { inserts: [], deletes: deleteIds },
    result: { added: 0, addFailed: 0, removed, removeFailed },
    errors,
  };
};

const mergeRunResult = (state: ChunkedExecutionState, runResult: RunResult): void => {
  state.changes.inserts.push(...runResult.changes.inserts);
  state.changes.deletes.push(...runResult.changes.deletes);
  state.result = {
    added: state.result.added + runResult.result.added,
    addFailed: state.result.addFailed + runResult.result.addFailed,
    removed: state.result.removed + runResult.result.removed,
    removeFailed: state.result.removeFailed + runResult.result.removeFailed,
  };
  state.errors.push(...runResult.errors);
};

type ProgressCallback = (processed: number, total: number) => void;

const OPERATION_CHUNK_SIZE = 50;

const chunkOperations = <TOperation>(operations: TOperation[], size: number): TOperation[][] => {
  const chunks: TOperation[][] = [];
  for (let offset = 0; offset < operations.length; offset += size) {
    chunks.push(operations.slice(offset, offset + size));
  }
  return chunks;
};

interface ChunkedExecutionState {
  changes: PendingChanges;
  result: SyncResult;
  errors: OperationError[];
  processed: number;
  superseded: boolean;
}

const checkSuperseded = async (
  state: ChunkedExecutionState,
  isCurrent?: () => Promise<boolean>,
): Promise<boolean> => {
  if (!isCurrent) {
    return false;
  }
  const stillCurrent = await isCurrent();
  if (!stillCurrent) {
    state.superseded = true;
    return true;
  }
  return false;
};

const executeChunkedAdds = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
): Promise<void> => {
  const chunks = chunkOperations(adds, OPERATION_CHUNK_SIZE);
  for (const chunk of chunks) {
    if (state.superseded) {
      return;
    }
    const runResult = await executeAddRun(chunk, calendarId, provider);
    mergeRunResult(state, runResult);
    state.processed += chunk.length;
    onRunComplete?.(state.processed, totalOperations);
    await checkSuperseded(state, isCurrent);
  }
};

const executeChunkedRemoves = async (
  removes: Extract<SyncOperation, { type: "remove" }>[],
  provider: CalendarSyncProvider,
  mappingsByDestinationUid: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
): Promise<void> => {
  const chunks = chunkOperations(removes, OPERATION_CHUNK_SIZE);
  for (const chunk of chunks) {
    if (state.superseded) {
      return;
    }
    const runResult = await executeRemoveRun(chunk, provider, mappingsByDestinationUid);
    mergeRunResult(state, runResult);
    state.processed += chunk.length;
    onRunComplete?.(state.processed, totalOperations);
    await checkSuperseded(state, isCurrent);
  }
};

const executeRemoteOperations = async (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
  calendarId: string,
  provider: CalendarSyncProvider,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
): Promise<ExecuteRemoteResult> => {
  const mappingsByDestinationUid = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByDestinationUid.set(mapping.destinationEventUid, mapping);
  }

  const runs = groupOperationRuns(operations);
  const totalOperations = operations.length;
  const state: ChunkedExecutionState = {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
    errors: [],
    processed: 0,
    superseded: false,
  };

  for (const run of runs) {
    if (state.superseded) {
      break;
    }

    if (run.type === "add" && run.adds.length > 0) {
      await executeChunkedAdds(run.adds, calendarId, provider, state, totalOperations, isCurrent, onRunComplete);
    }

    if (run.type === "remove" && run.removes.length > 0) {
      await executeChunkedRemoves(run.removes, provider, mappingsByDestinationUid, state, totalOperations, isCurrent, onRunComplete);
    }
  }

  return { changes: state.changes, result: state.result, errors: state.errors, superseded: state.superseded };
};

interface SyncCalendarOptions {
  userId: string;
  calendarId: string;
  provider: CalendarSyncProvider;
  readState: () => Promise<{
    localEvents: SyncableEvent[];
    existingMappings: EventMapping[];
    remoteEvents: RemoteEvent[];
  }>;
  isCurrent: () => Promise<boolean>;
  isInvalidated?: () => Promise<boolean>;
  flush: (changes: PendingChanges) => Promise<void>;
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
}

interface SyncCalendarResult extends SyncResult {
  errors: string[];
}

const EMPTY_RESULT: SyncCalendarResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0, errors: [] };

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncCalendarResult> => {
  const { userId, calendarId, provider, readState, isCurrent, isInvalidated, flush, onSyncEvent, onProgress } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "sync:calendar",
    "operation.type": "sync",
  };

  const startTime = Date.now();
  let flushed = false;

  const emitProgress = (stage: SyncProgressUpdate["stage"], localEventCount: number, remoteEventCount: number, progress?: { current: number; total: number }): void => {
    if (!onProgress) {
      return;
    }
    onProgress({
      userId,
      calendarId,
      status: "syncing",
      stage,
      localEventCount,
      remoteEventCount,
      progress,
      inSync: false,
    });
  };

  try {
    emitProgress("fetching", 0, 0);
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

    emitProgress("comparing", state.localEvents.length, state.remoteEvents.length);
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

    emitProgress("processing", state.localEvents.length, state.remoteEvents.length, { current: 0, total: operations.length });

    const outcome = await executeRemoteOperations(
      operations,
      state.existingMappings,
      calendarId,
      provider,
      isCurrent,
      (processed, total) => {
        emitProgress("processing", state.localEvents.length, state.remoteEvents.length, { current: processed, total });
      },
    );

    wideEvent["events.added"] = outcome.result.added;
    wideEvent["events.add_failed"] = outcome.result.addFailed;
    wideEvent["events.removed"] = outcome.result.removed;
    wideEvent["events.remove_failed"] = outcome.result.removeFailed;
    wideEvent["superseded"] = outcome.superseded;

    if (outcome.errors.length > 0) {
      wideEvent["operation_errors"] = outcome.errors;
    }

    outcome.changes.deletes.push(...staleMappingIds);

    const invalidated = await isInvalidated?.() ?? false;
    if (!invalidated) {
      await flush(outcome.changes);
      flushed = true;
    }

    wideEvent["invalidated"] = invalidated;
    wideEvent["outcome"] = resolveOutcome(outcome.superseded, invalidated);
    wideEvent["flushed"] = flushed;
    wideEvent["flush.inserts"] = outcome.changes.inserts.length;
    wideEvent["flush.deletes"] = outcome.changes.deletes.length;

    const errorMessages = outcome.errors.map((operationError) => operationError.error);
    return { ...outcome.result, errors: errorMessages };
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

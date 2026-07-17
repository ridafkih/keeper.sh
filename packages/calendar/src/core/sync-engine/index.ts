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
  errorType?: string;
  statusCode?: number;
}

const processAddResults = (
  addOperations: Extract<SyncOperation, { type: "add" }>[],
  pushResults: PushResult[],
  calendarId: string,
): { changes: PendingChanges; added: number; addFailed: number; conflictsResolved: number; errors: OperationError[] } => {
  const changes: PendingChanges = { inserts: [], deletes: [] };
  const errors: OperationError[] = [];
  let added = 0;
  let addFailed = 0;
  let conflictsResolved = 0;

  for (let index = 0; index < addOperations.length; index++) {
    const operation = addOperations[index];
    const pushResult = pushResults[index];

    if (!operation || !pushResult?.success) {
      addFailed += 1;
      if (pushResult?.error) {
        errors.push({
          type: "add",
          error: pushResult.error,
          ...(pushResult.errorType && { errorType: pushResult.errorType }),
          ...(typeof pushResult.statusCode === "number" && { statusCode: pushResult.statusCode }),
        });
      }
      continue;
    }

    if (!pushResult.remoteId) {
      if (operation.staleMappingId) {
        changes.deletes.push(operation.staleMappingId);
      }
      continue;
    }

    added += 1;
    if (pushResult.conflictResolved) {
      conflictsResolved += 1;
    }
    changes.inserts.push({
      eventStateId: operation.event.id,
      calendarId,
      destinationEventUid: pushResult.remoteId,
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId,
      syncEventHash: createSyncEventContentHash(operation.event),
      startTime: operation.event.startTime,
      endTime: operation.event.endTime,
    });
    if (operation.staleMappingId) {
      changes.deletes.push(operation.staleMappingId);
    }
  }

  return { changes, added, addFailed, conflictsResolved, errors };
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
        errors.push({
          type: "remove",
          error: deleteResult.error,
          ...(deleteResult.errorType && { errorType: deleteResult.errorType }),
          ...(typeof deleteResult.statusCode === "number" && { statusCode: deleteResult.statusCode }),
        });
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
  conflictsResolved: number;
  errors: OperationError[];
  superseded: boolean;
  checkpointRejected: boolean;
}

interface RunResult {
  changes: PendingChanges;
  result: SyncResult;
  conflictsResolved: number;
  errors: OperationError[];
}

const executeAddRun = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<RunResult> => {
  const addEvents = adds.map((op) => op.event);
  const pushResults = await provider.pushEvents(addEvents);
  const { added, addFailed, conflictsResolved, changes, errors } = processAddResults(adds, pushResults, calendarId);
  return {
    changes,
    result: { added, addFailed, removed: 0, removeFailed: 0 },
    conflictsResolved,
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
    conflictsResolved: 0,
    errors,
  };
};

const mergeRunResult = (
  state: ChunkedExecutionState,
  runResult: RunResult,
  includeChanges = true,
): void => {
  if (includeChanges) {
    state.changes.inserts.push(...runResult.changes.inserts);
    state.changes.deletes.push(...runResult.changes.deletes);
  }
  state.result = {
    added: state.result.added + runResult.result.added,
    addFailed: state.result.addFailed + runResult.result.addFailed,
    removed: state.result.removed + runResult.result.removed,
    removeFailed: state.result.removeFailed + runResult.result.removeFailed,
  };
  state.conflictsResolved += runResult.conflictsResolved;
  state.errors.push(...runResult.errors);
  if (includeChanges) {
    for (const insert of runResult.changes.inserts) {
      state.protectedRemoteUids.add(insert.destinationEventUid);
    }
  }
};

type ProgressCallback = (processed: number, total: number) => void;
type CheckpointCallback = (changes: PendingChanges) => Promise<boolean>;

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
  conflictsResolved: number;
  errors: OperationError[];
  processed: number;
  superseded: boolean;
  checkpointRejected: boolean;
  protectedRemoteUids: Set<string>;
}

const checkpointRun = async (
  state: ChunkedExecutionState,
  changes: PendingChanges,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  if (!checkpoint || (changes.inserts.length === 0 && changes.deletes.length === 0)) {
    return true;
  }

  const accepted = await checkpoint(changes);
  if (accepted === false) {
    state.checkpointRejected = true;
    return false;
  }
  return true;
};

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

const executeAdds = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
  checkpoint?: CheckpointCallback,
): Promise<void> => {
  if (adds.length === 0) {
    return;
  }

  const runResult = await executeAddRun(adds, calendarId, provider);
  mergeRunResult(state, runResult);
  if (!(await checkpointRun(state, runResult.changes, checkpoint))) {
    return;
  }
  state.processed += adds.length;
  onRunComplete?.(state.processed, totalOperations);
  await checkSuperseded(state, isCurrent);
};

const executeRemoves = async (
  removes: Extract<SyncOperation, { type: "remove" }>[],
  provider: CalendarSyncProvider,
  mappingsByDestinationUid: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
  checkpoint?: CheckpointCallback,
): Promise<void> => {
  if (removes.length === 0) {
    return;
  }

  const actionable = removes.filter((operation) => !state.protectedRemoteUids.has(operation.uid));
  if (actionable.length > 0) {
    const runResult = await executeRemoveRun(actionable, provider, mappingsByDestinationUid);
    mergeRunResult(state, runResult);
    if (!(await checkpointRun(state, runResult.changes, checkpoint))) {
      return;
    }
  }
  state.processed += removes.length;
  onRunComplete?.(state.processed, totalOperations);
  await checkSuperseded(state, isCurrent);
};

const executeReplacements = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsByDestinationUid: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
  checkpoint?: CheckpointCallback,
): Promise<void> => {
  if (replacements.length === 0) {
    return;
  }

  const removes: Extract<SyncOperation, { type: "remove" }>[] = replacements.map((operation) => ({
    deleteId: operation.deleteId,
    startTime: operation.event.startTime,
    type: "remove",
    uid: operation.uid,
  }));
  const deleteResults = await provider.deleteEvents(removes.map((operation) => operation.deleteId));
  const processedRemoves = processDeleteResults(removes, deleteResults, mappingsByDestinationUid);
  mergeRunResult(state, {
    changes: { inserts: [], deletes: processedRemoves.deleteIds },
    result: {
      added: 0,
      addFailed: 0,
      removed: processedRemoves.removed,
      removeFailed: processedRemoves.removeFailed,
    },
    conflictsResolved: 0,
    errors: processedRemoves.errors,
  }, false);

  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  for (let index = 0; index < replacements.length; index++) {
    if (deleteResults[index]?.success) {
      const replacement = replacements[index];
      if (replacement) {
        adds.push({
          event: replacement.event,
          staleMappingId: replacement.staleMappingId,
          type: "add",
        });
      }
    }
  }

  if (adds.length > 0) {
    const addResult = await executeAddRun(adds, calendarId, provider);
    mergeRunResult(state, addResult);
    if (!(await checkpointRun(state, addResult.changes, checkpoint))) {
      return;
    }
  }

  state.processed += replacements.length * 2;
  onRunComplete?.(state.processed, totalOperations);
  await checkSuperseded(state, isCurrent);
};

const getOperationWeight = (operation: SyncOperation): number => {
  if (operation.type === "replace") {
    return 2;
  }
  return 1;
};

const getTotalOperationCount = (operations: SyncOperation[]): number =>
  operations.reduce((total, operation) => total + getOperationWeight(operation), 0);

const executeRemoteOperations = async (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
  calendarId: string,
  provider: CalendarSyncProvider,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
  checkpoint?: CheckpointCallback,
): Promise<ExecuteRemoteResult> => {
  const mappingsByDestinationUid = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByDestinationUid.set(mapping.destinationEventUid, mapping);
  }

  const operationChunks = chunkOperations(operations, OPERATION_CHUNK_SIZE);
  const totalOperations = getTotalOperationCount(operations);
  const state: ChunkedExecutionState = {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
    processed: 0,
    superseded: false,
    checkpointRejected: false,
    protectedRemoteUids: new Set<string>(),
  };

  for (const chunk of operationChunks) {
    if (state.superseded || state.checkpointRejected) {
      break;
    }

    const removes = chunk.filter(
      (operation): operation is Extract<SyncOperation, { type: "remove" }> => operation.type === "remove",
    );
    await executeRemoves(
      removes,
      provider,
      mappingsByDestinationUid,
      state,
      totalOperations,
      isCurrent,
      onRunComplete,
      checkpoint,
    );

    if (state.superseded || state.checkpointRejected) {
      break;
    }

    const replacements = chunk.filter(
      (operation): operation is Extract<SyncOperation, { type: "replace" }> => operation.type === "replace",
    );
    await executeReplacements(
      replacements,
      calendarId,
      provider,
      mappingsByDestinationUid,
      state,
      totalOperations,
      isCurrent,
      onRunComplete,
      checkpoint,
    );

    if (state.superseded || state.checkpointRejected) {
      break;
    }

    const adds = chunk.filter(
      (operation): operation is Extract<SyncOperation, { type: "add" }> => operation.type === "add",
    );
    await executeAdds(
      adds,
      calendarId,
      provider,
      state,
      totalOperations,
      isCurrent,
      onRunComplete,
      checkpoint,
    );
  }

  return {
    changes: state.changes,
    result: state.result,
    conflictsResolved: state.conflictsResolved,
    errors: state.errors,
    superseded: state.superseded,
    checkpointRejected: state.checkpointRejected,
  };
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
  conflictsResolved: number;
  errors: string[];
}

const EMPTY_RESULT: SyncCalendarResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0, conflictsResolved: 0, errors: [] };

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncCalendarResult> => {
  const { userId, calendarId, provider, readState, isCurrent, isInvalidated, flush, onSyncEvent, onProgress } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "sync:calendar",
    "operation.type": "sync",
  };

  const startTime = Date.now();
  let flushed = false;
  let checkpointInvalidated = false;

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

    const addCount = operations.filter((op) => op.type === "add" || op.type === "replace").length;
    const removeCount = operations.filter((op) => op.type === "remove" || op.type === "replace").length;

    wideEvent["operations.add_count"] = addCount;
    wideEvent["operations.remove_count"] = removeCount;
    wideEvent["operations.total"] = addCount + removeCount;
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

    emitProgress("processing", state.localEvents.length, state.remoteEvents.length, {
      current: 0,
      total: getTotalOperationCount(operations),
    });

    const outcome = await executeRemoteOperations(
      operations,
      state.existingMappings,
      calendarId,
      provider,
      isCurrent,
      (processed, total) => {
        emitProgress("processing", state.localEvents.length, state.remoteEvents.length, { current: processed, total });
      },
      async (changes) => {
        const invalidated = await isInvalidated?.() ?? false;
        if (invalidated) {
          checkpointInvalidated = true;
          return false;
        }
        await flush(changes);
        flushed = true;
        return true;
      },
    );

    wideEvent["events.added"] = outcome.result.added;
    wideEvent["events.add_failed"] = outcome.result.addFailed;
    wideEvent["events.removed"] = outcome.result.removed;
    wideEvent["events.remove_failed"] = outcome.result.removeFailed;
    wideEvent["events.conflicts_resolved"] = outcome.conflictsResolved;
    wideEvent["superseded"] = outcome.superseded;

    if (outcome.errors.length > 0) {
      wideEvent["operation_errors"] = outcome.errors;
    }

    const invalidated = checkpointInvalidated || outcome.checkpointRejected || (await isInvalidated?.() ?? false);

    wideEvent["invalidated"] = invalidated;
    wideEvent["outcome"] = resolveOutcome(outcome.superseded, invalidated);
    wideEvent["flushed"] = flushed;
    wideEvent["flush.inserts"] = outcome.changes.inserts.length;
    wideEvent["flush.deletes"] = outcome.changes.deletes.length;

    const errorMessages = outcome.errors.map((operationError) => operationError.error);
    return { ...outcome.result, conflictsResolved: outcome.conflictsResolved, errors: errorMessages };
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

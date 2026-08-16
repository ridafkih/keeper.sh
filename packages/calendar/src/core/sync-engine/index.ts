import type {
  DeleteResult,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEvent,
  SyncOperation,
  SyncResult,
} from "../types";
import { hasPushEchoDivergence } from "../events/push-echo";
import type { EventMapping } from "../events/mappings";
import { getDatabaseErrorDetails } from "@keeper.sh/database";
import type { SyncProgressUpdate } from "../sync/types";
import { createSyncEventContentHash } from "../events/content-hash";
import { computeSyncOperations } from "../sync/operations";
import type { ReconciliationScope, StaleReasonCounts } from "../sync/operations";
import { classifyInboundChanges } from "../sync/write-back";
import type {
  DeleteConfirmationRequest,
  InboundClassification,
  InboundCounters,
  WriteBackHoldRequest,
} from "../sync/write-back";
import type { CalendarSyncProvider, PendingChanges, PendingUpdate } from "./types";

/*
 * A run whose provider rejects everything produces one error per operation. The wide
 * event is emitted once per run, so the risk is not volume but a single log line
 * carrying thousands of objects. A sample plus the uncapped total keeps the line
 * bounded while still reporting the true scale of the failure.
 */
const OPERATION_ERROR_SAMPLE_SIZE = 20;

const SYNC_PHASES = [
  "read_state",
  "currency_check",
  "compute_operations",
  "provider_push",
  "provider_delete",
  "checkpoint_flush",
  "mapping_flush",
] as const;

type SyncPhase = (typeof SYNC_PHASES)[number];

const roundDuration = (durationMs: number): number => Math.round(durationMs * 100) / 100;

const createPhaseTimer = () => {
  const totals = new Map<SyncPhase, number>();

  const record = (phase: SyncPhase, startedAt: number): void => {
    totals.set(phase, (totals.get(phase) ?? 0) + (performance.now() - startedAt));
  };

  const measure = async <TResult>(phase: SyncPhase, run: () => Promise<TResult>): Promise<TResult> => {
    const startedAt = performance.now();
    try {
      return await run();
    } finally {
      record(phase, startedAt);
    }
  };

  const measureSync = <TResult>(phase: SyncPhase, run: () => TResult): TResult => {
    const startedAt = performance.now();
    try {
      return run();
    } finally {
      record(phase, startedAt);
    }
  };

  const appendFields = (event: Record<string, unknown>, totalDurationMs: number): void => {
    let attributed = 0;
    for (const phase of SYNC_PHASES) {
      const phaseDurationMs = totals.get(phase) ?? 0;
      attributed += phaseDurationMs;
      event[`sync.phase.${phase}.duration_ms`] = roundDuration(phaseDurationMs);
    }
    event["sync.reconcile.duration_ms"] = roundDuration(totalDurationMs);
    event["sync.phase.unattributed.duration_ms"] = roundDuration(totalDurationMs - attributed);
  };

  return { appendFields, measure, measureSync };
};

const createTimedProvider = (
  provider: CalendarSyncProvider,
  timer: ReturnType<typeof createPhaseTimer>,
): CalendarSyncProvider => {
  const { getSyncDiagnostics, getThrottleMetrics } = provider;
  return {
    deleteEvents: (eventIds) => timer.measure("provider_delete", () => provider.deleteEvents(eventIds)),
    listRemoteEvents: (options) => provider.listRemoteEvents(options),
    pushEvents: (events) => timer.measure("provider_push", () => provider.pushEvents(events)),
    ...(getSyncDiagnostics && { getSyncDiagnostics: () => getSyncDiagnostics() }),
    ...(getThrottleMetrics && { getThrottleMetrics: () => getThrottleMetrics() }),
  };
};

const resolveOutcome = (superseded: boolean): string => {
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

interface PushEchoCounts {
  allDay: number;
  changed: number;
  compared: number;
  description: number;
  descriptionEchoLength: number;
  descriptionSentLength: number;
  end: number;
  location: number;
  locationEchoLength: number;
  locationSentLength: number;
  start: number;
  summary: number;
  summaryEchoLength: number;
  summarySentLength: number;
  uncomparable: number;
}

const createPushEchoCounts = (): PushEchoCounts => ({
  allDay: 0,
  changed: 0,
  compared: 0,
  description: 0,
  descriptionEchoLength: 0,
  descriptionSentLength: 0,
  end: 0,
  location: 0,
  locationEchoLength: 0,
  locationSentLength: 0,
  start: 0,
  summary: 0,
  summaryEchoLength: 0,
  summarySentLength: 0,
  uncomparable: 0,
});

/*
 * A successful push whose result carries no echo verdict counts as uncomparable:
 * a zero that means "we never looked" must not be distinguishable from a zero
 * that means "we looked and it matched" only by reading the provider's source.
 */
const tallyPushEcho = (counts: PushEchoCounts, pushResults: PushResult[]): void => {
  for (const pushResult of pushResults) {
    if (!pushResult.success || !pushResult.remoteId) {
      continue;
    }
    const { echo } = pushResult;
    if (!echo || !echo.comparable) {
      counts.uncomparable += 1;
      continue;
    }
    counts.compared += 1;
    const { divergence } = echo;
    if (!hasPushEchoDivergence(divergence)) {
      continue;
    }
    counts.changed += 1;
    counts.allDay += Number(divergence.allDay);
    counts.description += Number(divergence.description);
    counts.end += Number(divergence.end);
    counts.location += Number(divergence.location);
    counts.start += Number(divergence.start);
    counts.summary += Number(divergence.summary);
    const { lengths } = divergence;
    counts.descriptionEchoLength += lengths.description?.echo ?? 0;
    counts.descriptionSentLength += lengths.description?.sent ?? 0;
    counts.locationEchoLength += lengths.location?.echo ?? 0;
    counts.locationSentLength += lengths.location?.sent ?? 0;
    counts.summaryEchoLength += lengths.summary?.echo ?? 0;
    counts.summarySentLength += lengths.summary?.sent ?? 0;
  }
};

const appendPushEchoFields = (
  event: Record<string, unknown>,
  counts: PushEchoCounts,
): void => {
  const fields: [string, number][] = [
    ["push_echo.compared_count", counts.compared],
    ["push_echo.uncomparable_count", counts.uncomparable],
    ["push_echo.changed_count", counts.changed],
    ["push_echo.summary_changed_count", counts.summary],
    ["push_echo.description_changed_count", counts.description],
    ["push_echo.location_changed_count", counts.location],
    ["push_echo.all_day_changed_count", counts.allDay],
    ["push_echo.start_changed_count", counts.start],
    ["push_echo.end_changed_count", counts.end],
  ];

  for (const [field, count] of fields) {
    if (count > 0) {
      event[field] = count;
    }
  }

  const lengthTotals: { changed: number; echo: number; field: string; sent: number }[] = [
    {
      changed: counts.summary,
      echo: counts.summaryEchoLength,
      field: "summary",
      sent: counts.summarySentLength,
    },
    {
      changed: counts.description,
      echo: counts.descriptionEchoLength,
      field: "description",
      sent: counts.descriptionSentLength,
    },
    {
      changed: counts.location,
      echo: counts.locationEchoLength,
      field: "location",
      sent: counts.locationSentLength,
    },
  ];

  for (const { changed, echo, field, sent } of lengthTotals) {
    if (changed === 0) {
      continue;
    }
    event[`push_echo.${field}_sent_length_total`] = sent;
    event[`push_echo.${field}_echo_length_total`] = echo;
  }
};

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
      eventStateId: operation.event.eventStateId ?? operation.event.id,
      sourceCalendarId: operation.event.calendarId,
      syncEventId: operation.event.id,
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
  mappingsByRemoteIdentity: Map<string, EventMapping>,
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
    const mappingId = operation.mappingId
      ?? mappingsByRemoteIdentity.get(`${operation.uid}\u0000${operation.deleteId}`)?.id;
    if (mappingId) {
      deleteIds.push(mappingId);
    }
  }

  return { deleteIds, removed, removeFailed, errors };
};

interface ExecuteRemoteResult {
  changes: PendingChanges;
  result: SyncResult;
  conflictsResolved: number;
  errors: OperationError[];
  pushEcho: PushEchoCounts;
  superseded: boolean;
  checkpointRejected: boolean;
}

interface RunResult {
  changes: PendingChanges;
  result: SyncResult;
  conflictsResolved: number;
  errors: OperationError[];
  pushEcho?: PushEchoCounts;
}

const executeAddRun = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<RunResult> => {
  const addEvents = adds.map((op) => op.event);
  const pushResults = await provider.pushEvents(addEvents);
  const { added, addFailed, conflictsResolved, changes, errors } = processAddResults(adds, pushResults, calendarId);
  const pushEcho = createPushEchoCounts();
  tallyPushEcho(pushEcho, pushResults);
  return {
    changes,
    result: { added, addFailed, removed: 0, removeFailed: 0 },
    conflictsResolved,
    errors,
    pushEcho,
  };
};

const executeRemoveRun = async (
  removes: Extract<SyncOperation, { type: "remove" }>[],
  provider: CalendarSyncProvider,
  mappingsByRemoteIdentity: Map<string, EventMapping>,
): Promise<RunResult> => {
  const idsToDelete = removes.map((op) => op.deleteId);
  const deleteResults = await provider.deleteEvents(idsToDelete);
  const { removed, removeFailed, deleteIds, errors } = processDeleteResults(removes, deleteResults, mappingsByRemoteIdentity);
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
  if (runResult.pushEcho) {
    for (const key of Object.keys(state.pushEcho) as (keyof PushEchoCounts)[]) {
      state.pushEcho[key] += runResult.pushEcho[key];
    }
  }
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
  pushEcho: PushEchoCounts;
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
  mappingsByRemoteIdentity: Map<string, EventMapping>,
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
    const runResult = await executeRemoveRun(actionable, provider, mappingsByRemoteIdentity);
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
  mappingsByRemoteIdentity: Map<string, EventMapping>,
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
  const processedRemoves = processDeleteResults(removes, deleteResults, mappingsByRemoteIdentity);
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
  const mappingsByRemoteIdentity = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByRemoteIdentity.set(
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`,
      mapping,
    );
  }

  const operationChunks = chunkOperations(operations, OPERATION_CHUNK_SIZE);
  const totalOperations = getTotalOperationCount(operations);
  const state: ChunkedExecutionState = {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
    processed: 0,
    pushEcho: createPushEchoCounts(),
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
      mappingsByRemoteIdentity,
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
      mappingsByRemoteIdentity,
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
    pushEcho: state.pushEcho,
    superseded: state.superseded,
    checkpointRejected: state.checkpointRejected,
  };
};

interface ApplyInboundChangesInput {
  calendarId: string;
  classifications: InboundClassification[];
  now: Date;
}

interface ApplyInboundChangesResult {
  abandoned?: number;
  applied: number;
  deleteBlocked?: number;
  failed: number;
}

interface SyncCalendarOptions {
  userId: string;
  calendarId: string;
  provider: CalendarSyncProvider;
  readState: () => Promise<{
    localEvents: MaterializedSyncableEvent[];
    existingMappings: EventMapping[];
    remoteEvents: RemoteEvent[];
    remoteRawItemCount: number;
  }>;
  isCurrent: () => Promise<boolean>;
  flush: (changes: PendingChanges) => Promise<void>;
  applyInboundChanges?: (
    input: ApplyInboundChangesInput,
  ) => Promise<ApplyInboundChangesResult>;
  requestDeleteConfirmation?: (request: DeleteConfirmationRequest) => Promise<void>;
  /*
   * A read that came back with copies is the only thing that releases "Delete the
   * originals" after a read that returned nothing at all, and it has to outlive the pass
   * that observed it, so it is handed out to be recorded rather than kept in the counters.
   */
  recordHealthyRead?: (sourceCalendarIds: string[]) => Promise<void>;
  holdWriteBack?: (request: WriteBackHoldRequest) => Promise<void>;
  now?: () => Date;
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
  reconciliationScope: ReconciliationScope;
}

interface SyncCalendarResult extends SyncResult {
  conflictsResolved: number;
  errors: string[];
}

const EMPTY_RESULT: SyncCalendarResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0, conflictsResolved: 0, errors: [] };

const appendDatabaseErrorFields = (
  event: Record<string, unknown>,
  error: unknown,
): void => {
  const databaseError = getDatabaseErrorDetails(error);
  if (!databaseError) {
    return;
  }
  if (databaseError.sqlState) {
    event["error.database.sqlstate"] = databaseError.sqlState;
  }
  if (databaseError.message) {
    event["error.database.message"] = databaseError.message;
  }
  if (databaseError.detail) {
    event["error.database.detail"] = databaseError.detail;
  }
  if (databaseError.constraint) {
    event["error.database.constraint"] = databaseError.constraint;
  }
};

const appendStaleReasonFields = (
  event: Record<string, unknown>,
  counts: StaleReasonCounts,
): void => {
  const fields: [string, number][] = [
    ["stale_mappings.local_hash_changed_count", counts.localHashChanged],
    ["stale_mappings.occurrence_reassigned_count", counts.occurrenceReassigned],
    ["stale_mappings.remote_availability_changed_count", counts.remoteAvailabilityChanged],
    ["stale_mappings.remote_content_changed_count", counts.remoteContentChanged],
    ["stale_mappings.remote_content_all_day_changed_count", counts.remoteContentAllDayChanged],
    [
      "stale_mappings.remote_content_description_changed_count",
      counts.remoteContentDescriptionChanged,
    ],
    ["stale_mappings.remote_content_location_changed_count", counts.remoteContentLocationChanged],
    ["stale_mappings.remote_content_summary_changed_count", counts.remoteContentSummaryChanged],
    ["stale_mappings.remote_missing_count", counts.remoteMissing],
    ["stale_mappings.remote_time_changed_count", counts.remoteTimeChanged],
  ];

  for (const [field, count] of fields) {
    if (count > 0) {
      event[field] = count;
    }
  }

  const lengthTotals: { changed: number; field: string; local: number; remote: number }[] = [
    {
      changed: counts.remoteContentSummaryChanged,
      field: "summary",
      local: counts.remoteContentSummaryLocalLengthTotal,
      remote: counts.remoteContentSummaryRemoteLengthTotal,
    },
    {
      changed: counts.remoteContentDescriptionChanged,
      field: "description",
      local: counts.remoteContentDescriptionLocalLengthTotal,
      remote: counts.remoteContentDescriptionRemoteLengthTotal,
    },
    {
      changed: counts.remoteContentLocationChanged,
      field: "location",
      local: counts.remoteContentLocationLocalLengthTotal,
      remote: counts.remoteContentLocationRemoteLengthTotal,
    },
  ];

  for (const { changed, field, local, remote } of lengthTotals) {
    if (changed === 0) {
      continue;
    }
    event[`stale_mappings.remote_content_${field}_local_length_total`] = local;
    event[`stale_mappings.remote_content_${field}_remote_length_total`] = remote;
  }
};

const appendThrottleFields = (
  event: Record<string, unknown>,
  metrics?: ProviderThrottleMetrics,
): void => {
  if (!metrics || metrics.retryCount === 0) {
    return;
  }
  event["provider.retry_count"] = metrics.retryCount;
  event["provider.retry_after_ms"] = metrics.retryAfterMs;
};

const appendProviderDiagnostics = (
  event: Record<string, unknown>,
  diagnostics?: Record<string, number | string>,
): void => {
  for (const [field, value] of Object.entries(diagnostics ?? {})) {
    event[field] = value;
  }
};

const appendTwoWayFields = (
  event: Record<string, unknown>,
  counters: InboundCounters,
  readHealth: string,
): void => {
  const fields: [string, number][] = [
    ["two_way.adopt_window_divergence_count", counters.adoptWindowDivergence],
    ["two_way.ambiguous_empty_read_count", counters.ambiguousEmptyRead],
    ["two_way.blocked_availability_count", counters.blockedAvailability],
    ["two_way.blocked_redacted_field_count", counters.blockedRedactedField],
    ["two_way.conflict_source_wins_count", counters.conflictSourceWins],
    ["two_way.delete_breaker_tripped_count", counters.deleteBreakerTripped],
    ["two_way.edit_breaker_tripped_count", counters.editBreakerTripped],
  ];

  for (const [field, count] of fields) {
    if (count > 0) {
      event[field] = count;
    }
  }

  if (readHealth !== "healthy") {
    event["two_way.read_health"] = readHealth;
  }
};

const collectInboundMappingUpdates = (
  classifications: InboundClassification[],
): PendingUpdate[] => {
  const updates: PendingUpdate[] = [];
  for (const classification of classifications) {
    if ("mappingUpdate" in classification && classification.mappingUpdate) {
      updates.push(classification.mappingUpdate);
    }
  }
  return updates;
};

const collectOperationMappingIds = (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
): Set<string> => {
  const mappingsByRemoteIdentity = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByRemoteIdentity.set(
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`,
      mapping,
    );
  }

  const touched = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "remove") {
      const mapping = mappingsByRemoteIdentity.get(
        `${operation.uid}\u0000${operation.deleteId}`,
      );
      if (mapping) {
        touched.add(mapping.id);
      }
      continue;
    }
    if (operation.staleMappingId) {
      touched.add(operation.staleMappingId);
    }
  }
  return touched;
};

/*
 * A push rewrites the copy, so the observation recorded against it stops being true the
 * moment the provider accepts the write. Clearing the witness before the remote
 * operations rather than after them means a crash in between leaves a mapping that
 * adopts what it finds instead of one that reads our own write as a user edit.
 */
const collectPreWriteUnverifyUpdates = (
  operations: SyncOperation[],
  existingMappings: EventMapping[],
): PendingUpdate[] => {
  const touched = collectOperationMappingIds(operations, existingMappings);
  if (touched.size === 0) {
    return [];
  }

  return existingMappings
    .filter((mapping) =>
      touched.has(mapping.id) && typeof mapping.destinationContentHash === "string")
    .map((mapping) => ({
      destinationAvailability: null,
      destinationContentHash: null,
      destinationDescription: null,
      destinationEndTime: null,
      destinationIsAllDay: null,
      destinationLocation: null,
      destinationStartTime: null,
      destinationSummary: null,
      id: mapping.id,
    }));
};

const reportDeleteConfirmation = async (
  request: DeleteConfirmationRequest | null,
  report?: (request: DeleteConfirmationRequest) => Promise<void>,
): Promise<void> => {
  if (!request || !report) {
    return;
  }
  await report(request);
};

const reportHealthyRead = async (
  sourceCalendarIds: string[],
  report?: (sourceCalendarIds: string[]) => Promise<void>,
): Promise<void> => {
  if (sourceCalendarIds.length === 0 || !report) {
    return;
  }
  await report(sourceCalendarIds);
};

const reportWriteBackHold = async (
  request: WriteBackHoldRequest | null,
  report?: (request: WriteBackHoldRequest) => Promise<void>,
): Promise<void> => {
  if (!request || !report) {
    return;
  }
  await report(request);
};

const NO_APPLIED_CHANGES = 0;

const isApplierActionable = (classification: InboundClassification): boolean =>
  classification.type === "write-back" || classification.type === "delete";

const runInboundWriteBack = async (input: {
  applyInboundChanges?: (
    applyInput: ApplyInboundChangesInput,
  ) => Promise<ApplyInboundChangesResult>;
  calendarId: string;
  classifications: InboundClassification[];
  flush: (changes: PendingChanges) => Promise<void>;
  mappingUpdates: PendingUpdate[];
  now: Date;
  wideEvent: Record<string, unknown>;
}): Promise<{ claimedThePass: boolean; flushed: boolean }> => {
  if (!input.applyInboundChanges || input.classifications.length === NO_APPLIED_CHANGES) {
    return { claimedThePass: false, flushed: false };
  }
  const applied = await input.applyInboundChanges({
    calendarId: input.calendarId,
    classifications: input.classifications,
    now: input.now,
  });
  input.wideEvent["two_way.write_back_count"] = applied.applied;
  if (applied.failed > 0) {
    input.wideEvent["two_way.write_back_failed_count"] = applied.failed;
  }
  /*
   * A deletion the destination refused to confirm is indistinguishable from the feature
   * not working unless it is reported.
   */
  if (applied.deleteBlocked && applied.deleteBlocked > 0) {
    input.wideEvent["two_way.delete_probe_blocked_count"] = applied.deleteBlocked;
  }
  if (applied.abandoned && applied.abandoned > 0) {
    input.wideEvent["two_way.write_back_abandoned_count"] = applied.abandoned;
  }

  /*
   * Only a write-back that reached the source may claim the pass. Inbound work that
   * applied nothing left event_states exactly as the diff will read it, and claiming the
   * pass on it anyway would freeze every ordinary push to this destination for as long as
   * that work keeps failing to complete.
   */
  if (applied.applied === NO_APPLIED_CHANGES) {
    return { claimedThePass: false, flushed: false };
  }

  let flushed = false;
  if (input.mappingUpdates.length > 0) {
    await input.flush({ deletes: [], inserts: [], updates: input.mappingUpdates });
    flushed = true;
  }
  input.wideEvent["outcome"] = "write_back_applied";
  input.wideEvent["flushed"] = flushed;
  return { claimedThePass: true, flushed };
};

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncCalendarResult> => {
  const {
    userId,
    calendarId,
    provider,
    readState,
    isCurrent,
    flush,
    applyInboundChanges,
    requestDeleteConfirmation,
    recordHealthyRead,
    holdWriteBack,
    now,
    onSyncEvent,
    onProgress,
    reconciliationScope,
  } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "sync:calendar",
    "operation.type": "sync",
  };

  const startTime = Date.now();
  const reconcileStartedAt = performance.now();
  const timer = createPhaseTimer();
  const timedProvider = createTimedProvider(provider, timer);
  const timedIsCurrent = () => timer.measure("currency_check", isCurrent);
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
    const state = await timer.measure("read_state", readState);
    const localEvents = state.localEvents.map(
      (event) => provider.normalizeEvent?.(event) ?? event,
    );

    wideEvent["local_events.count"] = localEvents.length;
    wideEvent["existing_mappings.count"] = state.existingMappings.length;
    wideEvent["remote_events.count"] = state.remoteEvents.length;

    const stillCurrent = await timedIsCurrent();
    if (!stillCurrent) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    emitProgress("comparing", localEvents.length, state.remoteEvents.length);
    const passNow = now?.() ?? new Date();
    const inbound = classifyInboundChanges({
      existingMappings: state.existingMappings,
      localEvents: state.localEvents,
      now: passNow,
      projectLocalEvent: (event) => provider.normalizeEvent?.(event) ?? event,
      remoteEvents: state.remoteEvents,
      remoteRawItemCount: state.remoteRawItemCount,
      scope: reconciliationScope,
    });
    appendTwoWayFields(wideEvent, inbound.counters, inbound.readHealth);
    /*
     * A pass can raise both at once for the same pair, and both are recorded on the one
     * write-back state the pair has. The question about the copies that vanished is written
     * last so it is the state that stands: a quarantine reverts the pair to one-way, which
     * re-creates the copies the question is about and strands their pending state, while the
     * question keeps the mode and writes nothing anywhere until a human answers.
     */
    await reportHealthyRead(inbound.healthyReadSourceCalendarIds, recordHealthyRead);
    await reportWriteBackHold(inbound.writeBackHold, holdWriteBack);
    await reportDeleteConfirmation(inbound.deleteConfirmation, requestDeleteConfirmation);
    const inboundMappingUpdates = collectInboundMappingUpdates(inbound.classifications);
    const actionableInboundChanges = inbound.classifications.filter(isApplierActionable);

    const inboundPass = await runInboundWriteBack({
      ...(applyInboundChanges && { applyInboundChanges }),
      calendarId,
      classifications: actionableInboundChanges,
      flush,
      mappingUpdates: inboundMappingUpdates,
      now: passNow,
      wideEvent,
    });

    if (inboundPass.claimedThePass) {
      ({ flushed } = inboundPass);
      return EMPTY_RESULT;
    }

    const {
      mappingUpdates,
      operations,
      staleMappingIds,
      staleReasonCounts,
    } = timer.measureSync("compute_operations", () => computeSyncOperations(
      localEvents,
      state.existingMappings,
      state.remoteEvents,
      reconciliationScope,
      new Set(inbound.suppressedMappingIds),
    ));

    const allMappingUpdates = [...mappingUpdates, ...inboundMappingUpdates];
    const addCount = operations.filter((op) => op.type === "add" || op.type === "replace").length;
    const removeCount = operations.filter((op) => op.type === "remove" || op.type === "replace").length;

    wideEvent["operations.add_count"] = addCount;
    wideEvent["operations.remove_count"] = removeCount;
    wideEvent["operations.total"] = addCount + removeCount;
    wideEvent["stale_mappings.count"] = staleMappingIds.length;
    appendStaleReasonFields(wideEvent, staleReasonCounts);
    wideEvent["mapping_updates.count"] = allMappingUpdates.length;

    if (
      operations.length === 0
      && staleMappingIds.length === 0
      && allMappingUpdates.length === 0
    ) {
      wideEvent["outcome"] = "in-sync";
      wideEvent["flushed"] = false;
      wideEvent["events.added"] = 0;
      wideEvent["events.add_failed"] = 0;
      wideEvent["events.removed"] = 0;
      wideEvent["events.remove_failed"] = 0;
      return EMPTY_RESULT;
    }

    emitProgress("processing", localEvents.length, state.remoteEvents.length, {
      current: 0,
      total: getTotalOperationCount(operations),
    });

    const unverifyUpdates = collectPreWriteUnverifyUpdates(
      operations,
      state.existingMappings,
    );
    if (unverifyUpdates.length > 0) {
      await flush({ deletes: [], inserts: [], updates: unverifyUpdates });
      flushed = true;
      wideEvent["two_way.pre_write_unverify_count"] = unverifyUpdates.length;
    }

    const outcome = await executeRemoteOperations(
      operations,
      state.existingMappings,
      calendarId,
      timedProvider,
      timedIsCurrent,
      (processed, total) => {
        emitProgress("processing", localEvents.length, state.remoteEvents.length, { current: processed, total });
      },
      async (changes) => {
        await timer.measure("checkpoint_flush", () => flush(changes));
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
    appendPushEchoFields(wideEvent, outcome.pushEcho);

    if (outcome.errors.length > 0) {
      wideEvent["operation_errors"] = outcome.errors.slice(0, OPERATION_ERROR_SAMPLE_SIZE);
      wideEvent["operation_errors.count"] = outcome.errors.length;
      wideEvent["operation_errors.truncated"] = outcome.errors.length > OPERATION_ERROR_SAMPLE_SIZE;
    }

    if (allMappingUpdates.length > 0) {
      await timer.measure(
        "mapping_flush",
        () => flush({ deletes: [], inserts: [], updates: allMappingUpdates }),
      );
      flushed = true;
    }

    wideEvent["outcome"] = resolveOutcome(outcome.superseded);
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

    appendDatabaseErrorFields(wideEvent, error);

    throw error;
  } finally {
    /*
     * These two cover the same span on different clocks -- duration_ms is wall-clock and
     * sync.reconcile.duration_ms is monotonic -- and must never be differenced.
     */
    wideEvent["duration_ms"] = Date.now() - startTime;
    timer.appendFields(wideEvent, performance.now() - reconcileStartedAt);
    appendThrottleFields(wideEvent, provider.getThrottleMetrics?.());
    appendProviderDiagnostics(wideEvent, provider.getSyncDiagnostics?.());
    onSyncEvent?.(wideEvent);
  }
};

export { executeRemoteOperations, syncCalendar, OPERATION_ERROR_SAMPLE_SIZE };
export type { CalendarSyncProvider, PendingChanges, SyncCalendarOptions };

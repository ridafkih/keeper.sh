import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEvent,
  SyncOperation,
  SyncResult,
} from "../types";
import { hasPushEchoDivergence } from "../events/push-echo";
import type { EventMapping } from "../events/mappings";
import { NO_DESTINATION_EVENT_IDENTIFIER, namesEventInDestination } from "../events/mappings";
import { getDatabaseErrorDetails } from "@keeper.sh/database";
import type { SyncProgressUpdate } from "../sync/types";
import { createSyncEventContentHash } from "../events/content-hash";
import { computeSyncOperations } from "../sync/operations";
import type { ReconciliationScope, StaleReasonCounts } from "../sync/operations";
import type { CalendarSyncProvider, EventUpdate, PendingChanges, PendingUpdate } from "./types";
import { getErrorMessage } from "../utils/error";
import { isTimeoutErrorName } from "../utils/fetch-with-timeout";

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
  const { updateEvents } = provider;
  return {
    ...provider,
    deleteEvents: (eventIds) => timer.measure("provider_delete", () => provider.deleteEvents(eventIds)),
    listRemoteEvents: (options) => provider.listRemoteEvents(options),
    pushEvents: (events) => timer.measure("provider_push", () => provider.pushEvents(events)),
    ...(updateEvents && { updateEvents: (updates: EventUpdate[]) => timer.measure("provider_push", () => updateEvents(updates)) }),
  };
};

const resolveOutcome = (superseded: boolean): string => {
  if (superseded) {
    return "superseded";
  }
  return "success";
};

interface OperationError {
  type: "add" | "remove" | "update";
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

const toAcknowledgedWriteError = (
  type: OperationError["type"],
  pushResult: PushResult,
): OperationError | null => {
  if (!pushResult.error) {
    return null;
  }
  return {
    type,
    error: pushResult.error,
    ...(pushResult.errorType && { errorType: pushResult.errorType }),
    ...(typeof pushResult.statusCode === "number" && { statusCode: pushResult.statusCode }),
  };
};

const recordInsert = (
  insert: PendingChanges["inserts"][number],
  pushResult: PushResult,
  changes: PendingChanges,
  recovered: PendingChanges["inserts"],
): void => {
  if (pushResult.identitySource === "read") {
    recovered.push(insert);
    return;
  }
  changes.inserts.push(insert);
};

const processAddResults = (
  addOperations: Extract<SyncOperation, { type: "add" }>[],
  pushResults: PushResult[],
  calendarId: string,
): {
  changes: PendingChanges;
  added: number;
  addFailed: number;
  conflictsResolved: number;
  errors: OperationError[];
  recovered: PendingChanges["inserts"];
} => {
  const changes: PendingChanges = { inserts: [], deletes: [] };
  const recovered: PendingChanges["inserts"] = [];
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
    const acknowledgedError = toAcknowledgedWriteError("add", pushResult);
    if (acknowledgedError) {
      errors.push(acknowledgedError);
    }
    if (pushResult.conflictResolved) {
      conflictsResolved += 1;
    }
    const insert = {
      eventStateId: operation.event.eventStateId ?? operation.event.id,
      sourceCalendarId: operation.event.calendarId,
      syncEventId: operation.event.id,
      calendarId,
      destinationEventUid: pushResult.remoteId,
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId,
      syncEventHash: createSyncEventContentHash(operation.event),
      startTime: operation.event.startTime,
      endTime: operation.event.endTime,
    };
    recordInsert(insert, pushResult, changes, recovered);
    if (operation.staleMappingId) {
      changes.deletes.push(operation.staleMappingId);
    }
  }

  return { changes, added, addFailed, conflictsResolved, errors, recovered };
};

const GONE_STATUS_CODES = new Set([404, 410]);

const isUpdateTargetGone = (pushResult: PushResult | undefined): boolean =>
  typeof pushResult?.statusCode === "number" && GONE_STATUS_CODES.has(pushResult.statusCode);

const needsReplacementFallback = (pushResult: PushResult | undefined): boolean =>
  isUpdateTargetGone(pushResult);

const RETRYABLE_UPDATE_STATUS_CODES = new Set([408, 409, 412, 425, 429]);

const TRANSPORT_ERROR_TYPES = new Set(["AbortError", "FetchError", "TypeError"]);

const REFUSED_WRITE_STATUS_CODES = new Set([401, 403]);

const UNDELIVERED_BATCH_ERROR_TYPES = new Set(["GoogleBatchProtocolError"]);

const learnedNothingFromDestination = (pushResult: PushResult | undefined): boolean => {
  if (!pushResult) {
    return false;
  }
  if (pushResult.destinationAnswer) {
    return pushResult.destinationAnswer === "unanswered";
  }
  if (typeof pushResult.statusCode === "number") {
    return pushResult.statusCode <= 0;
  }
  return UNDELIVERED_BATCH_ERROR_TYPES.has(pushResult.errorType ?? "");
};

const noRequestLeftTheProcess = (pushResult: PushResult | undefined): boolean =>
  pushResult?.requestSent === false;

const isTransportError = (errorType: string | undefined): boolean => {
  if (!errorType) {
    return false;
  }
  if (isTimeoutErrorName(errorType)) {
    return true;
  }
  return TRANSPORT_ERROR_TYPES.has(errorType);
};

const isRetryableStatus = (statusCode: number): boolean => {
  if (RETRYABLE_UPDATE_STATUS_CODES.has(statusCode)) {
    return true;
  }
  return statusCode >= 500;
};

const isDurableUpdateFailure = (pushResult: PushResult | undefined): boolean => {
  if (learnedNothingFromDestination(pushResult) || noRequestLeftTheProcess(pushResult)) {
    return false;
  }
  const { errorType, statusCode } = pushResult ?? {};
  if (typeof statusCode === "number") {
    if (isRetryableStatus(statusCode) || REFUSED_WRITE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    return true;
  }
  return !isTransportError(errorType);
};

const UPDATE_FAILURES_BEFORE_REPLACEMENT = 3;

const countUpdateFailure = (mapping: EventMapping | undefined): number =>
  (mapping?.consecutiveUpdateFailures ?? 0) + 1;

const clearedUpdateFailures = (mapping: EventMapping | undefined): { consecutiveUpdateFailures?: number } => {
  if (!mapping?.consecutiveUpdateFailures) {
    return {};
  }
  return { consecutiveUpdateFailures: 0 };
};

const toFailureCarry = (mapping: EventMapping, consecutiveUpdateFailures: number): PendingUpdate => ({
  consecutiveUpdateFailures,
  deleteIdentifier: mapping.deleteIdentifier,
  destinationEventUid: mapping.destinationEventUid,
  endTime: mapping.endTime,
  id: mapping.id,
  startTime: mapping.startTime,
  syncEventHash: mapping.syncEventHash,
  syncEventId: mapping.syncEventId,
});

const destinationAnsweredTheRefusal = (pushResult: PushResult | undefined): boolean => {
  if (pushResult?.destinationAnswer === "answered") {
    return true;
  }
  return typeof pushResult?.statusCode === "number" && pushResult.statusCode > 0;
};

const readPreparationFailure = (
  prepareEvent: NonNullable<CalendarSyncProvider["prepareEvent"]>,
  event: MaterializedSyncableEvent,
): string | null => {
  try {
    prepareEvent(event);
    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
};

const recreateCannotBeBuilt = (
  provider: CalendarSyncProvider,
  event: MaterializedSyncableEvent,
): boolean => {
  const { prepareEvent } = provider;
  if (!prepareEvent) {
    return false;
  }
  return readPreparationFailure(prepareEvent, event) !== null;
};

const recordPromotion = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
  provider: CalendarSyncProvider,
  destinations: {
    refused: Extract<SyncOperation, { type: "replace" }>[];
    unresolved: Extract<SyncOperation, { type: "replace" }>[];
  },
): void => {
  if (destinationAnsweredTheRefusal(pushResult) || recreateCannotBeBuilt(provider, operation.event)) {
    destinations.refused.push(operation);
    return;
  }
  destinations.unresolved.push(operation);
};

const createdANewMirror = (
  pushResult: PushResult,
  mapping: EventMapping | undefined,
): boolean => {
  if (!mapping || !pushResult.remoteId) {
    return false;
  }
  return pushResult.remoteId !== mapping.destinationEventUid;
};

const describeUpdateFailure = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
): string => {
  const cause = pushResult?.errorType ?? "unknown error";
  const status = pushResult?.statusCode ?? "no status";
  return `update failed for event ${operation.event.id}: ${cause} (${status})`;
};

const toUpdateFailureError = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
): OperationError => ({
  type: "update",
  error: pushResult?.error ?? describeUpdateFailure(operation, pushResult),
  ...(pushResult?.errorType && { errorType: pushResult.errorType }),
  ...(typeof pushResult?.statusCode === "number" && { statusCode: pushResult.statusCode }),
});

const isAnsweredRefusalOfTheBytes = (pushResult: PushResult | undefined): boolean => {
  if (pushResult?.requestSent !== true || pushResult.destinationAnswer !== "answered") {
    return false;
  }
  if (needsReplacementFallback(pushResult)) {
    return false;
  }
  return isDurableUpdateFailure(pushResult);
};

const toParkedRefusalError = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
): OperationError => ({
  ...toUpdateFailureError(operation, pushResult),
  error: `the update for mapping ${operation.staleMappingId} was refused and its mirror stands: ${pushResult?.error ?? describeUpdateFailure(operation, pushResult)}`,
});

const processUpdateResults = (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  pushResults: PushResult[],
  mappingsById: Map<string, EventMapping>,
  provider: CalendarSyncProvider,
): {
  changes: PendingChanges;
  created: number;
  updated: number;
  updateFailed: number;
  parked: number;
  conflictsResolved: number;
  errors: OperationError[];
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  refused: Extract<SyncOperation, { type: "replace" }>[];
  unaddressable: Set<string>;
} => {
  const updates: PendingUpdate[] = [];
  const errors: OperationError[] = [];
  const unresolved: Extract<SyncOperation, { type: "replace" }>[] = [];
  const refused: Extract<SyncOperation, { type: "replace" }>[] = [];
  const unaddressable = new Set<string>();
  let created = 0;
  let updated = 0;
  let updateFailed = 0;
  let parked = 0;
  let conflictsResolved = 0;

  for (let index = 0; index < replacements.length; index++) {
    const operation = replacements[index];
    const pushResult = pushResults[index];

    if (!operation) {
      continue;
    }

    if (!pushResult?.success) {
      updateFailed += 1;
      if (isAnsweredRefusalOfTheBytes(pushResult)) {
        parked += 1;
        errors.push(toParkedRefusalError(operation, pushResult));
      } else {
        errors.push(toUpdateFailureError(operation, pushResult));
      }

      if (noRequestLeftTheProcess(pushResult)) {
        unaddressable.add(operation.staleMappingId);
        refused.push(operation);
        continue;
      }

      if (needsReplacementFallback(pushResult)) {
        unresolved.push(operation);
        continue;
      }
      const failingMapping = mappingsById.get(operation.staleMappingId);
      if (failingMapping && isDurableUpdateFailure(pushResult)) {
        const failures = countUpdateFailure(failingMapping);
        if (failures >= UPDATE_FAILURES_BEFORE_REPLACEMENT) {
          recordPromotion(operation, pushResult, provider, { refused, unresolved });
          updates.push(toFailureCarry(failingMapping, 0));
          continue;
        }
        updates.push(toFailureCarry(failingMapping, failures));
      }
      continue;
    }

    updated += 1;
    const acknowledgedError = toAcknowledgedWriteError("update", pushResult);
    if (acknowledgedError) {
      errors.push(acknowledgedError);
    }
    if (createdANewMirror(pushResult, mappingsById.get(operation.staleMappingId))) {
      created += 1;
    }
    if (pushResult.conflictResolved) {
      conflictsResolved += 1;
    }
    updates.push({
      ...clearedUpdateFailures(mappingsById.get(operation.staleMappingId)),
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId ?? operation.deleteId,
      ...(pushResult.remoteId && { destinationEventUid: pushResult.remoteId }),
      endTime: operation.event.endTime,
      id: operation.staleMappingId,
      startTime: operation.event.startTime,
      syncEventHash: createSyncEventContentHash(operation.event),
      syncEventId: operation.event.id,
    });
  }

  return { changes: { inserts: [], deletes: [], updates }, created, updated, updateFailed, parked, conflictsResolved, errors, unresolved, refused, unaddressable };
};

const didRemoveObject = (deleteResult: DeleteResult | undefined): boolean => {
  if (deleteResult?.success !== true) {
    return false;
  }
  return deleteResult.removedObject === true;
};

const processDeleteResults = (
  removeOperations: Extract<SyncOperation, { type: "remove" }>[],
  deleteResults: DeleteResult[],
  mappingsByRemoteIdentity: Map<string, EventMapping>,
  requiresRemovalEvidence = false,
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

    if (requiresRemovalEvidence && !didRemoveObject(deleteResult)) {
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
  updateFallbacks: number;
  verificationUnsettled: number;
}

interface RunResult {
  changes: PendingChanges;
  result: SyncResult;
  conflictsResolved: number;
  errors: OperationError[];
  pushEcho?: PushEchoCounts;
  recovered?: PendingChanges["inserts"];
}

interface UpdateRunResult {
  runResult: RunResult;
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  refused: Extract<SyncOperation, { type: "replace" }>[];
  unaddressable: Set<string>;
}

const executeAddRun = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<RunResult> => {
  const addEvents = adds.map((op) => op.event);
  const pushResults = await provider.pushEvents(addEvents);
  const { added, addFailed, conflictsResolved, changes, errors, recovered } = processAddResults(adds, pushResults, calendarId);
  const pushEcho = createPushEchoCounts();
  tallyPushEcho(pushEcho, pushResults);
  return {
    changes,
    result: { added, addFailed, updated: 0, removed: 0, removeFailed: 0 },
    conflictsResolved,
    errors,
    pushEcho,
    recovered,
  };
};

const getErrorTypeName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return "UnknownError";
};

const isRunLevelAbort = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === "AbortError" || error.name === "TimeoutError");

const statusFromThrownError = (error: unknown): number | null => {
  if (!(error instanceof Error)) {
    return null;
  }
  const { status, statusCode } = error as Error & { status?: unknown; statusCode?: unknown };
  if (typeof status === "number") {
    return status;
  }
  if (typeof statusCode === "number") {
    return statusCode;
  }
  return null;
};

const runLevelUpdateFailure = (error: unknown): OperationError => {
  const statusCode = statusFromThrownError(error);
  return {
    type: "update",
    error: getErrorMessage(error),
    errorType: getErrorTypeName(error),
    ...(statusCode !== null && { statusCode }),
  };
};

type UpdateRunOutcome =
  | { pushResults: PushResult[] }
  | { runFailure: OperationError };

const runUpdateEvents = async (
  updateEvents: NonNullable<CalendarSyncProvider["updateEvents"]>,
  updates: EventUpdate[],
): Promise<UpdateRunOutcome> => {
  try {
    return { pushResults: await updateEvents(updates) };
  } catch (error) {
    if (isRunLevelAbort(error)) {
      throw error;
    }
    return { runFailure: runLevelUpdateFailure(error) };
  }
};

const failedUpdateRun = (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  runFailure: OperationError,
): UpdateRunResult => ({
  runResult: {
    changes: { inserts: [], deletes: [], updates: [] },
    result: { added: 0, addFailed: replacements.length, updated: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [runFailure],
  },
  refused: [],
  unaddressable: new Set(),
  unresolved: [],
});

const executeUpdateRun = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  updateEvents: NonNullable<CalendarSyncProvider["updateEvents"]>,
  mappingsById: Map<string, EventMapping>,
  provider: CalendarSyncProvider,
  verifiedUidByMappingId?: Map<string, string>,
): Promise<UpdateRunResult> => {
  const updates: EventUpdate[] = replacements.map((operation) => {
    const verifiedUid = verifiedUidByMappingId?.get(operation.staleMappingId);
    return {
      deleteId: operation.deleteId,
      event: operation.event,
      ...(verifiedUid && { verifiedUid }),
    };
  });
  const outcome = await runUpdateEvents(updateEvents, updates);
  if ("runFailure" in outcome) {
    return failedUpdateRun(replacements, outcome.runFailure);
  }
  const { pushResults } = outcome;
  const { created, updated, updateFailed, parked, conflictsResolved, changes, errors, unresolved, refused, unaddressable } = processUpdateResults(
    replacements,
    pushResults,
    mappingsById,
    provider,
  );
  const pushEcho = createPushEchoCounts();
  tallyPushEcho(pushEcho, pushResults);
  return {
    runResult: {
      changes,
      result: {
        added: created,
        addFailed: updateFailed,
        updated,
        removed: 0,
        removeFailed: 0,
        ...(parked > 0 && { parked }),
      },
      conflictsResolved,
      errors,
      pushEcho,
    },
    refused,
    unaddressable,
    unresolved,
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
    result: { added: 0, addFailed: 0, updated: 0, removed, removeFailed },
    conflictsResolved: 0,
    errors,
  };
};

const parkedTotal = (
  state: ChunkedExecutionState,
  runResult: RunResult,
): number => (state.result.parked ?? 0) + (runResult.result.parked ?? 0);

const mergeRunResult = (
  state: ChunkedExecutionState,
  runResult: RunResult,
  includeChanges = true,
): void => {
  if (includeChanges) {
    state.changes.inserts.push(...runResult.changes.inserts);
    state.changes.deletes.push(...runResult.changes.deletes);
    if (runResult.changes.updates) {
      state.changes.updates = [...(state.changes.updates ?? []), ...runResult.changes.updates];
    }
  }
  state.result = {
    added: state.result.added + runResult.result.added,
    addFailed: state.result.addFailed + runResult.result.addFailed,
    updated: state.result.updated + runResult.result.updated,
    removed: state.result.removed + runResult.result.removed,
    removeFailed: state.result.removeFailed + runResult.result.removeFailed,
    ...(parkedTotal(state, runResult) > 0 && { parked: parkedTotal(state, runResult) }),
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
  updateFallbacks: number;
  verificationUnsettled: number;
}

const checkpointRun = async (
  state: ChunkedExecutionState,
  changes: PendingChanges,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const updateCount = changes.updates?.length ?? 0;
  if (!checkpoint || (changes.inserts.length === 0 && changes.deletes.length === 0 && updateCount === 0)) {
    return true;
  }

  const accepted = await checkpoint(changes);
  if (accepted === false) {
    state.checkpointRejected = true;
    return false;
  }
  return true;
};

const commitAddRun = async (
  state: ChunkedExecutionState,
  addResult: RunResult,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  mergeRunResult(state, addResult);
  const recovered = addResult.recovered ?? [];
  if (recovered.length === 0) {
    return await checkpointRun(state, addResult.changes, checkpoint);
  }

  for (const insert of recovered) {
    state.protectedRemoteUids.add(insert.destinationEventUid);
  }
  if (!checkpoint) {
    state.changes.inserts.push(...recovered);
    return true;
  }

  return await checkpointRun(state, {
    deletes: addResult.changes.deletes,
    inserts: [...addResult.changes.inserts, ...recovered],
    ...(addResult.changes.updates && { updates: addResult.changes.updates }),
  }, checkpoint);
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
  if (!(await commitAddRun(state, runResult, checkpoint))) {
    return;
  }
  state.processed += adds.length;
  onRunComplete?.(state.processed, totalOperations);
  await checkSuperseded(state, isCurrent);
};

const namesNoDestinationEvent = (operation: Extract<SyncOperation, { type: "remove" }>): boolean =>
  operation.deleteId === NO_DESTINATION_EVENT_IDENTIFIER;

const recordUnremovableMirrors = (
  state: ChunkedExecutionState,
  unremovable: Extract<SyncOperation, { type: "remove" }>[],
): void => {
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: {
      added: 0,
      addFailed: 0,
      updated: 0,
      removed: 0,
      removeFailed: unremovable.length,
      parked: unremovable.length,
    },
    conflictsResolved: 0,
    errors: unremovable.map((operation) => ({
      type: "remove" as const,
      error: `nothing was removed for mapping ${operation.mappingId ?? operation.uid}: this destination calendar holds no event for it, and the copy the read found outside it may never be deleted`,
    })),
  }, false);
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

  const unremovable = removes.filter((operation) => namesNoDestinationEvent(operation));
  if (unremovable.length > 0) {
    recordUnremovableMirrors(state, unremovable);
  }

  const actionable = removes.filter((operation) =>
    !namesNoDestinationEvent(operation) && !state.protectedRemoteUids.has(operation.uid));
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

const recordUnbuildableRecreate = (
  state: ChunkedExecutionState,
  replacement: Extract<SyncOperation, { type: "replace" }>,
  cause: string,
): void => {
  state.errors.push({
    type: "update",
    error: `refusing to delete the mirror for mapping ${replacement.staleMappingId}: its replacement cannot be built, so nothing could be put back: ${cause}`,
  });
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 1, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

const withBuildableRecreate = (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  provider: CalendarSyncProvider,
  state: ChunkedExecutionState,
): Extract<SyncOperation, { type: "replace" }>[] => {
  const { prepareEvent } = provider;
  if (!prepareEvent) {
    return replacements;
  }
  const buildable: Extract<SyncOperation, { type: "replace" }>[] = [];
  for (const replacement of replacements) {
    const failure = readPreparationFailure(prepareEvent, replacement.event);
    if (failure === null) {
      buildable.push(replacement);
      continue;
    }
    recordUnbuildableRecreate(state, replacement, failure);
  }
  return buildable;
};

const replaceViaDeleteThenAdd = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsByRemoteIdentity: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  requiresRemovalEvidence: boolean,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const licensesRecreate = (deleteResult: DeleteResult | undefined): boolean => {
    if (requiresRemovalEvidence) {
      return didRemoveObject(deleteResult);
    }
    return deleteResult?.success === true;
  };

  const buildable = withBuildableRecreate(replacements, provider, state);
  if (buildable.length === 0) {
    return true;
  }

  const removes: Extract<SyncOperation, { type: "remove" }>[] = buildable.map((operation) => ({
    deleteId: operation.deleteId,
    startTime: operation.event.startTime,
    type: "remove",
    uid: operation.uid,
  }));
  const deleteResults = await provider.deleteEvents(removes.map((operation) => operation.deleteId));
  const processedRemoves = processDeleteResults(
    removes,
    deleteResults,
    mappingsByRemoteIdentity,
    requiresRemovalEvidence,
  );
  mergeRunResult(state, {
    changes: { inserts: [], deletes: processedRemoves.deleteIds },
    result: {
      added: 0,
      addFailed: 0,
      updated: 0,
      removed: processedRemoves.removed,
      removeFailed: processedRemoves.removeFailed,
    },
    conflictsResolved: 0,
    errors: processedRemoves.errors,
  }, false);

  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const unchanged: OperationError[] = [];
  for (let index = 0; index < buildable.length; index++) {
    const replacement = buildable[index];
    if (!replacement) {
      continue;
    }
    const deleteResult = deleteResults[index];
    if (licensesRecreate(deleteResult)) {
      adds.push({
        event: replacement.event,
        staleMappingId: replacement.staleMappingId,
        type: "add",
      });
      continue;
    }

    if (deleteResult?.success === true) {
      unchanged.push({
        type: "update",
        error: `replacement changed nothing for event ${replacement.event.id}: the delete removed no object`,
      });
    }
  }

  if (unchanged.length > 0) {
    mergeRunResult(state, {
      changes: { inserts: [], deletes: [] },
      result: { added: 0, addFailed: unchanged.length, updated: 0, removed: 0, removeFailed: 0 },
      conflictsResolved: 0,
      errors: unchanged,
    }, false);
  }

  if (adds.length > 0) {
    const addResult = await executeAddRun(adds, calendarId, provider);
    if (!(await commitAddRun(state, addResult, checkpoint))) {
      return false;
    }
  }

  return true;
};

const isEventPresence = (entry: EventPresence | RemoteEvent): entry is EventPresence =>
  "status" in entry;

interface MirrorVerdicts {
  absent: Set<string>;
  located: Map<string, RemoteEvent>;
  confirmed: Set<string>;
  elsewhere: Map<string, RemoteEvent>;
  unsettled: Set<string>;
  unsettledReason: string;
  unsettledReasons: Map<string, string>;
}

const UNSETTLED_BY_REPORT = "the verification read returned no verdict for it";

const UNSETTLED_BY_EMPTY_ANSWER = "the verification read came back saying nothing at all about it";

const unsettledByIdentityMismatch = (askedUid: string, answeredUid: string): string =>
  `the verification read answered about ${answeredUid} at an identifier asked about for ${askedUid}`;

const noVerdicts = (): MirrorVerdicts => ({
  absent: new Set(),
  confirmed: new Set(),
  elsewhere: new Map(),
  located: new Map(),
  unsettled: new Set(),
  unsettledReason: UNSETTLED_BY_REPORT,
  unsettledReasons: new Map(),
});

const answersAboutADifferentEvent = (
  presence: EventPresence,
  askedUids: Map<string, string>,
): boolean => {
  const askedUid = askedUids.get(presence.identifier);
  if (!askedUid || !presence.event?.uid) {
    return false;
  }
  return presence.event.uid !== askedUid;
};

const verdictsFromPresenceReport = (
  report: EventPresence[],
  askedUids: Map<string, string>,
): MirrorVerdicts => {
  const verdicts = noVerdicts();
  for (const presence of report) {
    if (presence.status === "absent") {
      verdicts.absent.add(presence.identifier);
      continue;
    }
    if (answersAboutADifferentEvent(presence, askedUids)) {
      verdicts.unsettledReasons.set(
        presence.identifier,
        unsettledByIdentityMismatch(
          askedUids.get(presence.identifier) ?? "",
          presence.event?.uid ?? "",
        ),
      );
      continue;
    }
    if (presence.status === "elsewhere" && presence.event) {
      verdicts.elsewhere.set(presence.identifier, presence.event);
      continue;
    }
    if (presence.status === "present") {
      verdicts.confirmed.add(presence.identifier);
    }
    if (presence.status === "present" && presence.event) {
      verdicts.located.set(presence.identifier, presence.event);
    }
  }
  return verdicts;
};

const answersOnlyAboutIdentifiers = (identifiers: string[], found: RemoteEvent[]): boolean => {
  const asked = new Set(identifiers);
  for (const event of found) {
    if (!asked.has(event.deleteId) && !asked.has(event.uid)) {
      return false;
    }
  }
  return true;
};

const absencesFromFoundEvents = (identifiers: string[], found: RemoteEvent[]): Set<string> => {
  if (!answersOnlyAboutIdentifiers(identifiers, found)) {
    return new Set();
  }

  const present = new Set<string>();
  for (const event of found) {
    present.add(event.deleteId);
    present.add(event.uid);
  }

  const absent = new Set<string>();
  for (const identifier of identifiers) {
    if (!present.has(identifier)) {
      absent.add(identifier);
    }
  }
  return absent;
};

const settledIdentifiersFromPresenceReport = (
  report: EventPresence[],
  askedUids: Map<string, string>,
): Set<string> => {
  const settled = new Set<string>();
  for (const presence of report) {
    if (presence.status === "unknown") {
      continue;
    }
    if (answersAboutADifferentEvent(presence, askedUids)) {
      continue;
    }
    if ((presence.status === "present" || presence.status === "elsewhere") && !presence.event) {
      continue;
    }
    settled.add(presence.identifier);
  }
  return settled;
};

const settledIdentifiersFromFoundEvents = (found: RemoteEvent[], absent: Set<string>): Set<string> => {
  const settled = new Set<string>(absent);
  for (const event of found) {
    settled.add(event.deleteId);
    settled.add(event.uid);
  }
  return settled;
};

const unsettledIdentifiers = (identifiers: string[], settled: Set<string>): Set<string> =>
  new Set(identifiers.filter((identifier) => !settled.has(identifier)));

type VerificationRead =
  | { report: EventPresence[] | RemoteEvent[] }
  | { readFailure: string };

const readVerification = async (
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  targets: EventVerificationTarget[],
): Promise<VerificationRead> => {
  try {
    return { report: await verifyEventsExist(targets) };
  } catch (error) {
    if (isRunLevelAbort(error)) {
      throw error;
    }
    return { readFailure: getErrorMessage(error) };
  }
};

const verifyMirrors = async (
  targets: EventVerificationTarget[],
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  corroboratedAbsent: ReadonlySet<string>,
): Promise<MirrorVerdicts> => {
  const identifiers = targets.map((target) => target.deleteId);
  const askedUids = new Map<string, string>();
  for (const target of targets) {
    if (target.uid) {
      askedUids.set(target.deleteId, target.uid);
    }
  }
  const read = await readVerification(verifyEventsExist, targets);
  if ("readFailure" in read) {
    return {
      absent: new Set(),
      confirmed: new Set(),
      elsewhere: new Map(),
      located: new Map(),
      unsettled: new Set(identifiers),
      unsettledReason: read.readFailure,
      unsettledReasons: new Map(),
    };
  }
  if (read.report.length === 0) {
    return {
      absent: new Set(identifiers.filter((identifier) => corroboratedAbsent.has(identifier))),
      confirmed: new Set(),
      elsewhere: new Map(),
      located: new Map(),
      unsettled: new Set(identifiers.filter((identifier) => !corroboratedAbsent.has(identifier))),
      unsettledReason: UNSETTLED_BY_EMPTY_ANSWER,
      unsettledReasons: new Map(),
    };
  }

  const presences: EventPresence[] = [];
  const found: RemoteEvent[] = [];
  for (const entry of read.report) {
    if (isEventPresence(entry)) {
      presences.push(entry);
      continue;
    }
    found.push(entry);
  }

  if (presences.length > 0) {
    const verdicts = verdictsFromPresenceReport(presences, askedUids);
    return {
      ...verdicts,
      unsettled: unsettledIdentifiers(
        identifiers,
        settledIdentifiersFromPresenceReport(presences, askedUids),
      ),
    };
  }
  const absent = absencesFromFoundEvents(identifiers, found);
  return {
    absent,
    confirmed: new Set(),
    elsewhere: new Map(),
    located: new Map(),
    unsettled: unsettledIdentifiers(identifiers, settledIdentifiersFromFoundEvents(found, absent)),
    unsettledReason: UNSETTLED_BY_REPORT,
    unsettledReasons: new Map(),
  };
};

interface SurvivingMirror {
  event: RemoteEvent;
  inDestination: boolean;
}

const isOurMirror = (
  located: RemoteEvent,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): boolean => Boolean(located.uid) && Boolean(replacement.uid) && located.uid === replacement.uid;

const survivingMirror = (
  verdicts: MirrorVerdicts,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): SurvivingMirror | null => {
  const located = verdicts.located.get(replacement.deleteId);
  if (located && isOurMirror(located, replacement)) {
    return { event: located, inDestination: true };
  }
  const outside = verdicts.elsewhere.get(replacement.deleteId);
  if (outside && isOurMirror(outside, replacement)) {
    return { event: outside, inDestination: false };
  }
  return null;
};

const toRelocationRepair = (
  mapping: EventMapping,
  deleteIdentifier: string,
  destinationEventUid: string,
): PendingUpdate => ({
  deleteIdentifier,
  destinationEventUid,
  endTime: mapping.endTime,
  id: mapping.id,
  startTime: mapping.startTime,
  syncEventHash: mapping.syncEventHash,
  syncEventId: mapping.syncEventId,
});

const toOutsideDestinationRepair = (mapping: EventMapping): PendingUpdate => ({
  deleteIdentifier: NO_DESTINATION_EVENT_IDENTIFIER,
  destinationEventUid: mapping.destinationEventUid,
  endTime: mapping.endTime,
  id: mapping.id,
  startTime: mapping.startTime,
  syncEventHash: mapping.syncEventHash,
  syncEventId: mapping.syncEventId,
});

const recordMirrorOutsideDestination = (
  state: ChunkedExecutionState,
  replacement: Extract<SyncOperation, { type: "replace" }>,
  located: RemoteEvent,
): void => {
  state.errors.push({
    type: "update",
    error: `mapping ${replacement.staleMappingId} has no mirror in this destination calendar: the read found its event at ${located.deleteId} outside the calendar, so nothing here may be deleted by that identifier`,
  });
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 1, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

const toSurvivingMirrorRepair = (
  mapping: EventMapping,
  surviving: SurvivingMirror,
): PendingUpdate => {
  if (!surviving.inDestination) {
    return toOutsideDestinationRepair(mapping);
  }
  return toRelocationRepair(mapping, surviving.event.deleteId, surviving.event.uid);
};

const toInPlaceUpdate = (
  replacement: Extract<SyncOperation, { type: "replace" }>,
  deleteId: string,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId,
  event: replacement.event,
  staleMappingId: replacement.staleMappingId,
  type: "replace",
  uid: replacement.uid,
});

const mergeRepairsNotAlreadyRecorded = (
  state: ChunkedExecutionState,
  repairs: PendingUpdate[],
  recorded: PendingUpdate[],
): PendingUpdate[] => {
  const recordedIds = new Set(recorded.map((update) => update.id));
  const unrecorded = repairs.filter((repair) => !recordedIds.has(repair.id));
  if (unrecorded.length === 0) {
    return [];
  }
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [], updates: unrecorded },
    result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
  });
  return unrecorded;
};

const withLocatedIdentity = (
  updates: PendingUpdate[],
  locatedByMappingId: Map<string, RemoteEvent>,
): PendingUpdate[] =>
  updates.map((update) => {
    const located = locatedByMappingId.get(update.id);
    if (!located) {
      return update;
    }
    return { ...update, deleteIdentifier: located.deleteId, destinationEventUid: located.uid };
  });

const withoutAddCredit = (runResult: RunResult): RunResult => ({
  ...runResult,
  result: { ...runResult.result, added: 0 },
});

const withoutDestinationIdentity = (
  updates: PendingUpdate[],
  outsideByMappingId: Map<string, EventMapping>,
): PendingUpdate[] =>
  updates.map((update) => {
    const mapping = outsideByMappingId.get(update.id);
    if (!mapping) {
      return update;
    }
    return {
      ...update,
      deleteIdentifier: NO_DESTINATION_EVENT_IDENTIFIER,
      destinationEventUid: mapping.destinationEventUid,
    };
  });

const recordUnrepairableRefusal = (
  state: ChunkedExecutionState,
  replacement: Extract<SyncOperation, { type: "replace" }>,
  reason: string,
): void => {
  state.errors.push({
    type: "update",
    error: `the update for mapping ${replacement.staleMappingId} keeps failing and its mirror stands: ${reason}`,
  });
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 1, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

const recordUnreachableRelocation = (
  state: ChunkedExecutionState,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): void => {
  state.verificationUnsettled += 1;
  state.errors.push({
    type: "update",
    error: `the update for mapping ${replacement.staleMappingId} could not reach the mirror the read located at ${replacement.deleteId}: the destination answered that it is gone, so the mapping keeps the identifier it already held`,
  });
};

const withCarriedEvidence = (
  updates: PendingUpdate[],
  promotedMappingIds: Set<string>,
  mappingsById: Map<string, EventMapping>,
): PendingUpdate[] =>
  updates.map((update) => {
    if (!promotedMappingIds.has(update.id)) {
      return update;
    }
    const mapping = mappingsById.get(update.id);
    if (!mapping) {
      return update;
    }
    return { ...update, consecutiveUpdateFailures: countUpdateFailure(mapping) };
  });

const updateRelocatedMirrors = async (
  relocated: Extract<SyncOperation, { type: "replace" }>[],
  repairs: PendingUpdate[],
  locatedByMappingId: Map<string, RemoteEvent>,
  outsideByMappingId: Map<string, EventMapping>,
  provider: CalendarSyncProvider,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const { updateEvents } = provider;
  if (!updateEvents) {
    const unrecorded = mergeRepairsNotAlreadyRecorded(state, repairs, []);
    return checkpointRun(state, { inserts: [], deletes: [], updates: unrecorded }, checkpoint);
  }

  const verifiedUidByMappingId = new Map(
    [...locatedByMappingId].map(([mappingId, located]) => [mappingId, located.uid]),
  );
  const { runResult, refused, unresolved } = await executeUpdateRun(
    relocated,
    updateEvents,
    mappingsById,
    provider,
    verifiedUidByMappingId,
  );
  const unreachable = new Set(unresolved.map((operation) => operation.staleMappingId));
  const promoted = new Set(refused.map((operation) => operation.staleMappingId));
  const written = (runResult.changes.updates ?? []).filter((update) => !unreachable.has(update.id));
  const delivered = withoutDestinationIdentity(
    withLocatedIdentity(
      withCarriedEvidence(written, promoted, mappingsById),
      locatedByMappingId,
    ),
    outsideByMappingId,
  );
  const repairedRunResult: RunResult = {
    ...withoutAddCredit(runResult),
    changes: { ...runResult.changes, updates: delivered },
  };
  mergeRunResult(state, repairedRunResult);
  const reachedRepairs = repairs.filter((repair) => !unreachable.has(repair.id));
  const unrecorded = mergeRepairsNotAlreadyRecorded(state, reachedRepairs, delivered);
  for (const replacement of relocated) {
    state.protectedRemoteUids.add(replacement.uid);
  }
  state.updateFallbacks += unresolved.length + refused.length;
  if (!(await checkpointRun(state, {
    deletes: runResult.changes.deletes,
    inserts: runResult.changes.inserts,
    updates: [...delivered, ...unrecorded],
  }, checkpoint))) {
    return false;
  }

  for (const replacement of unresolved) {
    recordUnreachableRelocation(state, replacement);
  }

  for (const replacement of refused) {
    recordUnrepairableRefusal(
      state,
      replacement,
      `the destination keeps refusing the update to the mirror it located at ${replacement.deleteId}, so the stale copy stands`,
    );
  }
  return true;
};

interface UnsettledMirror {
  confirmedAtIdentifier: boolean;
  replacement: Extract<SyncOperation, { type: "replace" }>;
}

const recordUnsettledMirrors = (
  state: ChunkedExecutionState,
  verdicts: MirrorVerdicts,
  replacements: Extract<SyncOperation, { type: "replace" }>[],
): UnsettledMirror[] => {
  const unsettled: UnsettledMirror[] = [];
  for (const replacement of replacements) {
    if (!verdicts.unsettled.has(replacement.deleteId)) {
      continue;
    }
    unsettled.push({
      confirmedAtIdentifier: verdicts.confirmed.has(replacement.deleteId),
      replacement,
    });
    state.verificationUnsettled += 1;
    state.errors.push({
      type: "update",
      error: `verification could not settle the mirror for mapping ${replacement.staleMappingId}: ${verdicts.unsettledReasons.get(replacement.deleteId) ?? verdicts.unsettledReason}`,
    });
  }
  return unsettled;
};

const isTheSameMirror = (
  located: RemoteEvent,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): boolean => located.deleteId === replacement.deleteId && located.uid === replacement.uid;

const verifiedUidAddressesMirror = (
  located: RemoteEvent,
  replacement: Extract<SyncOperation, { type: "replace" }>,
  mappingsById: Map<string, EventMapping>,
  unaddressableMappingIds: ReadonlySet<string>,
): boolean => {
  if (!unaddressableMappingIds.has(replacement.staleMappingId)) {
    return false;
  }
  if (!located.uid || located.uid !== replacement.uid) {
    return false;
  }
  const mapping = mappingsById.get(replacement.staleMappingId);
  if (!mapping) {
    return false;
  }
  return mapping.syncEventId === replacement.event.id;
};

const resolveVerifiedMirrors = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
  updateAlreadyRefused = false,
  unaddressableMappingIds: ReadonlySet<string> = new Set(),
  unsettledSink?: UnsettledMirror[],
): Promise<boolean> => {
  const targets = replacements.map((operation) => ({
    deleteId: operation.deleteId,
    uid: operation.uid,
  }));
  const listingMissed = new Set(
    replacements
      .filter((operation) => operation.remoteMissing === true)
      .map((operation) => operation.deleteId),
  );
  const verdicts = await verifyMirrors(targets, verifyEventsExist, listingMissed);
  const unsettledReplacements = recordUnsettledMirrors(state, verdicts, replacements);
  unsettledSink?.push(...unsettledReplacements);
  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const relocated: Extract<SyncOperation, { type: "replace" }>[] = [];
  const repairs: PendingUpdate[] = [];
  const locatedByMappingId = new Map<string, RemoteEvent>();
  const outsideByMappingId = new Map<string, EventMapping>();
  for (const replacement of replacements) {
    const surviving = survivingMirror(verdicts, replacement);
    if (surviving) {
      const located = surviving.event;
      if (updateAlreadyRefused && isTheSameMirror(located, replacement)) {
        if (!verifiedUidAddressesMirror(located, replacement, mappingsById, unaddressableMappingIds)) {
          recordUnrepairableRefusal(
            state,
            replacement,
            `its mirror is still present at ${located.deleteId}, so the stale copy stands`,
          );
          continue;
        }
        locatedByMappingId.set(replacement.staleMappingId, located);
        relocated.push(toInPlaceUpdate(replacement, located.deleteId));
        continue;
      }
      const mapping = mappingsById.get(replacement.staleMappingId);
      if (mapping) {
        repairs.push(toSurvivingMirrorRepair(mapping, surviving));
      }
      if (surviving.inDestination) {
        locatedByMappingId.set(replacement.staleMappingId, located);
      }
      if (!surviving.inDestination) {
        recordMirrorOutsideDestination(state, replacement, located);
      }
      if (!surviving.inDestination && mapping) {
        outsideByMappingId.set(replacement.staleMappingId, mapping);
      }
      relocated.push(toInPlaceUpdate(replacement, located.deleteId));
      continue;
    }

    if (!verdicts.absent.has(replacement.deleteId)) {
      continue;
    }
    adds.push({
      event: replacement.event,
      staleMappingId: replacement.staleMappingId,
      type: "add",
    });
  }

  if (relocated.length > 0) {
    const delivered = await updateRelocatedMirrors(
      relocated,
      repairs,
      locatedByMappingId,
      outsideByMappingId,
      provider,
      mappingsById,
      state,
      checkpoint,
    );
    if (!delivered) {
      return false;
    }
  }

  if (adds.length === 0) {
    return true;
  }

  const addResult = await executeAddRun(adds, calendarId, provider);
  if (!(await commitAddRun(state, addResult, checkpoint))) {
    return false;
  }
  return true;
};

const recreateMissingMirrors = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
  unsettledSink?: UnsettledMirror[],
): Promise<boolean> => {
  const { verifyEventsExist } = provider;
  if (verifyEventsExist) {
    return resolveVerifiedMirrors(
      replacements,
      calendarId,
      provider,
      verifyEventsExist,
      mappingsById,
      state,
      checkpoint,
      false,
      new Set(),
      unsettledSink,
    );
  }

  const buildable = withBuildableRecreate(replacements, provider, state);
  if (buildable.length === 0) {
    return true;
  }

  const deleteResults = await provider.deleteEvents(buildable.map((operation) => operation.deleteId));
  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const errors: OperationError[] = [];
  let removed = 0;
  let removeFailed = 0;

  for (let index = 0; index < buildable.length; index++) {
    const replacement = buildable[index];
    if (!replacement) {
      continue;
    }
    const deleteResult = deleteResults[index];
    if (didRemoveObject(deleteResult)) {
      removed += 1;
      adds.push({
        event: replacement.event,
        staleMappingId: replacement.staleMappingId,
        type: "add",
      });
      continue;
    }

    if (deleteResult?.success === true) {
      continue;
    }

    removeFailed += 1;
    if (deleteResult?.error) {
      errors.push({
        type: "remove",
        error: deleteResult.error,
        ...(deleteResult.errorType && { errorType: deleteResult.errorType }),
        ...(typeof deleteResult.statusCode === "number" && { statusCode: deleteResult.statusCode }),
      });
    }
  }

  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, updated: 0, removed, removeFailed },
    conflictsResolved: 0,
    errors,
  }, false);

  if (adds.length === 0) {
    return true;
  }

  const addResult = await executeAddRun(adds, calendarId, provider);
  return await commitAddRun(state, addResult, checkpoint);
};

const countUnsettledRead = (state: ChunkedExecutionState, mapping: EventMapping): number => {
  const carried = (state.changes.updates ?? [])
    .findLast((update) => update.id === mapping.id);
  if (typeof carried?.consecutiveUnsettledReads === "number") {
    return carried.consecutiveUnsettledReads + 1;
  }
  return (mapping.consecutiveUnsettledReads ?? 0) + 1;
};

const unspentUpdateEvidence = (
  state: ChunkedExecutionState,
  mapping: EventMapping,
): { consecutiveUpdateFailures?: number } => {
  const carried = (state.changes.updates ?? [])
    .findLast((update) => update.id === mapping.id);
  if (carried?.consecutiveUpdateFailures !== 0) {
    return {};
  }
  return { consecutiveUpdateFailures: countUpdateFailure(mapping) };
};

const toUnsettledCarry = (
  state: ChunkedExecutionState,
  mapping: EventMapping,
  consecutiveUnsettledReads: number,
): PendingUpdate => ({
  ...unspentUpdateEvidence(state, mapping),
  consecutiveUnsettledReads,
  deleteIdentifier: mapping.deleteIdentifier,
  destinationEventUid: mapping.destinationEventUid,
  endTime: mapping.endTime,
  id: mapping.id,
  startTime: mapping.startTime,
  syncEventHash: mapping.syncEventHash,
  syncEventId: mapping.syncEventId,
});

const recordUnsettledPark = (state: ChunkedExecutionState): void => {
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

const parkUnsettledMirrors = (
  state: ChunkedExecutionState,
  unsettled: Extract<SyncOperation, { type: "replace" }>[],
  mappingsById: Map<string, EventMapping>,
): PendingUpdate[] => {
  const carries: PendingUpdate[] = [];
  for (const replacement of unsettled) {
    const mapping = mappingsById.get(replacement.staleMappingId);
    if (!mapping) {
      continue;
    }
    carries.push(toUnsettledCarry(state, mapping, countUnsettledRead(state, mapping)));
    recordUnsettledPark(state);
  }
  if (carries.length > 0) {
    mergeRunResult(state, {
      changes: { inserts: [], deletes: [], updates: carries },
      result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0 },
      conflictsResolved: 0,
      errors: [],
    });
  }
  return carries;
};

const escapeRefusedUpdates = async (
  refused: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  unaddressableMappingIds: ReadonlySet<string>,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const { verifyEventsExist } = provider;
  if (!verifyEventsExist) {
    for (const replacement of refused) {
      recordUnrepairableRefusal(
        state,
        replacement,
        "this destination cannot verify the mirror, so nothing proves it may be recreated",
      );
    }
    return true;
  }

  const unsettled: UnsettledMirror[] = [];
  if (!(await resolveVerifiedMirrors(
    refused,
    calendarId,
    provider,
    verifyEventsExist,
    mappingsById,
    state,
    checkpoint,
    true,
    unaddressableMappingIds,
    unsettled,
  ))) {
    return false;
  }

  if (unsettled.length === 0) {
    return true;
  }

  const carries = parkUnsettledMirrors(
    state,
    unsettled.map((mirror) => mirror.replacement),
    mappingsById,
  );
  return await checkpointRun(state, { inserts: [], deletes: [], updates: carries }, checkpoint);
};

const promoteUnresolvedReplacements = async (
  unresolved: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsByRemoteIdentity: Map<string, EventMapping>,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const { verifyEventsExist } = provider;
  if (!verifyEventsExist) {
    return await replaceViaDeleteThenAdd(
      unresolved,
      calendarId,
      provider,
      mappingsByRemoteIdentity,
      state,
      true,
      checkpoint,
    );
  }

  const unsettled: UnsettledMirror[] = [];
  if (!(await resolveVerifiedMirrors(
    unresolved,
    calendarId,
    provider,
    verifyEventsExist,
    mappingsById,
    state,
    checkpoint,
    false,
    new Set(),
    unsettled,
  ))) {
    return false;
  }

  if (unsettled.length === 0) {
    return true;
  }

  const unanswered = unsettled.filter((mirror) => !mirror.confirmedAtIdentifier);
  const carries = parkUnsettledMirrors(
    state,
    unanswered.map((mirror) => mirror.replacement),
    mappingsById,
  );
  if (!(await checkpointRun(state, { inserts: [], deletes: [], updates: carries }, checkpoint))) {
    return false;
  }

  const confirmed = unsettled
    .filter((mirror) => mirror.confirmedAtIdentifier)
    .map((mirror) => mirror.replacement);
  if (confirmed.length === 0) {
    return true;
  }

  return await replaceViaDeleteThenAdd(
    confirmed,
    calendarId,
    provider,
    mappingsByRemoteIdentity,
    state,
    true,
    checkpoint,
  );
};

const executeReplacements = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsByRemoteIdentity: Map<string, EventMapping>,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  totalOperations: number,
  isCurrent?: () => Promise<boolean>,
  onRunComplete?: ProgressCallback,
  checkpoint?: CheckpointCallback,
): Promise<void> => {
  if (replacements.length === 0) {
    return;
  }

  const { updateEvents } = provider;
  if (updateEvents) {
    const missing = replacements.filter((operation) => operation.remoteMissing === true);
    const present = replacements.filter((operation) => operation.remoteMissing !== true);
    let unresolved: Extract<SyncOperation, { type: "replace" }>[] = [];
    let refused: Extract<SyncOperation, { type: "replace" }>[] = [];
    let unaddressable: ReadonlySet<string> = new Set();

    if (present.length > 0) {
      const {
        runResult,
        refused: refusedUpdates,
        unaddressable: unaddressableMappings,
        unresolved: unresolvedUpdates,
      } = await executeUpdateRun(
        present,
        updateEvents,
        mappingsById,
        provider,
      );
      unresolved = unresolvedUpdates;
      refused = refusedUpdates;
      unaddressable = unaddressableMappings;
      mergeRunResult(state, runResult);
      const unresolvedMappingIds = new Set(
        [...unresolved, ...refused].map((operation) => operation.staleMappingId),
      );
      for (const replacement of present) {
        if (!unresolvedMappingIds.has(replacement.staleMappingId)) {
          state.protectedRemoteUids.add(replacement.uid);
        }
      }
      state.updateFallbacks += unresolved.length + refused.length;
      if (!(await checkpointRun(state, runResult.changes, checkpoint))) {
        return;
      }
    }

    if (refused.length > 0) {
      const escaped = await escapeRefusedUpdates(
        refused,
        calendarId,
        provider,
        mappingsById,
        state,
        unaddressable,
        checkpoint,
      );
      if (!escaped) {
        return;
      }
    }

    if (missing.length > 0) {
      const unsettled: UnsettledMirror[] = [];
      const restored = await recreateMissingMirrors(
        missing,
        calendarId,
        provider,
        mappingsById,
        state,
        checkpoint,
        unsettled,
      );
      if (!restored) {
        return;
      }
      const carries = parkUnsettledMirrors(
        state,
        unsettled.map((mirror) => mirror.replacement),
        mappingsById,
      );
      if (!(await checkpointRun(state, { inserts: [], deletes: [], updates: carries }, checkpoint))) {
        return;
      }
    }

    if (unresolved.length > 0) {
      const recovered = await promoteUnresolvedReplacements(
        unresolved,
        calendarId,
        provider,
        mappingsByRemoteIdentity,
        mappingsById,
        state,
        checkpoint,
      );
      if (!recovered) {
        return;
      }
    }
    state.processed += replacements.length * 2;
    onRunComplete?.(state.processed, totalOperations);
    await checkSuperseded(state, isCurrent);
    return;
  }

  if (!(await replaceViaDeleteThenAdd(
    replacements,
    calendarId,
    provider,
    mappingsByRemoteIdentity,
    state,
    false,
    checkpoint,
  ))) {
    return;
  }

  state.processed += replacements.length * 2;
  onRunComplete?.(state.processed, totalOperations);
  await checkSuperseded(state, isCurrent);
};

const rekeyedMappingForRemove = (
  operation: SyncOperation,
  missingMirrorMappingIdsByUid: Map<string, string>,
  mappingsById: Map<string, EventMapping>,
): EventMapping | null => {
  if (operation.type !== "remove" || operation.mappingId) {
    return null;
  }
  const mappingId = missingMirrorMappingIdsByUid.get(operation.uid);
  if (!mappingId) {
    return null;
  }
  const mapping = mappingsById.get(mappingId);
  if (!mapping || mapping.deleteIdentifier === operation.deleteId) {
    return null;
  }
  return mapping;
};

const readMissingMirrorMappingIdsByUid = (operations: SyncOperation[]): Map<string, string> => {
  const byUid = new Map<string, string>();
  for (const operation of operations) {
    if (operation.type === "replace" && operation.remoteMissing === true) {
      byUid.set(operation.uid, operation.staleMappingId);
    }
  }
  return byUid;
};

const isRepairedReplace = (operation: SyncOperation, repairedMappingIds: Set<string>): boolean => {
  if (operation.type !== "replace") {
    return false;
  }
  return repairedMappingIds.has(operation.staleMappingId);
};

interface RepairedPlan {
  operations: SyncOperation[];
  repairs: PendingUpdate[];
}

const repairRekeyedMirrorPlan = (
  operations: SyncOperation[],
  mappingsById: Map<string, EventMapping>,
): RepairedPlan => {
  const missingMirrorMappingIdsByUid = readMissingMirrorMappingIdsByUid(operations);
  if (missingMirrorMappingIdsByUid.size === 0) {
    return { operations, repairs: [] };
  }

  const repairs: PendingUpdate[] = [];
  const repairedMappingIds = new Set<string>();
  const kept: SyncOperation[] = [];
  for (const operation of operations) {
    const rekeyed = rekeyedMappingForRemove(operation, missingMirrorMappingIdsByUid, mappingsById);
    if (!rekeyed || operation.type !== "remove") {
      kept.push(operation);
      continue;
    }
    repairs.push(toRelocationRepair(rekeyed, operation.deleteId, operation.uid));
    repairedMappingIds.add(rekeyed.id);
  }

  return {
    operations: kept.filter((operation) => !isRepairedReplace(operation, repairedMappingIds)),
    repairs,
  };
};

const readOperationMappingId = (operation: SyncOperation): string | null => {
  if (operation.type === "remove") {
    return operation.mappingId ?? null;
  }
  return operation.staleMappingId ?? null;
};

const recordMirrorsOutsideDestination = (
  state: ChunkedExecutionState,
  existingMappings: EventMapping[],
  plannedOperations: SyncOperation[],
): void => {
  const plannedMappingIds = new Set(
    plannedOperations.map((operation) => readOperationMappingId(operation)).filter((id) => id !== null),
  );
  const unplanned = existingMappings.filter((mapping) =>
    !namesEventInDestination(mapping) && !plannedMappingIds.has(mapping.id));
  if (unplanned.length === 0) {
    return;
  }

  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: {
      added: 0,
      addFailed: unplanned.length,
      updated: 0,
      removed: 0,
      removeFailed: 0,
      parked: unplanned.length,
    },
    conflictsResolved: 0,
    errors: unplanned.map((mapping) => ({
      type: "update" as const,
      error: `this destination calendar holds no event for mapping ${mapping.id}: the read located the customer's copy outside it, so the mirror stays out of sync until it is back in the calendar`,
    })),
  }, false);
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
  const mappingsById = new Map<string, EventMapping>();
  for (const mapping of existingMappings) {
    mappingsByRemoteIdentity.set(
      `${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`,
      mapping,
    );
    mappingsById.set(mapping.id, mapping);
  }

  const { operations: plannedOperations, repairs } = repairRekeyedMirrorPlan(operations, mappingsById);
  const operationChunks = chunkOperations(plannedOperations, OPERATION_CHUNK_SIZE);
  const totalOperations = getTotalOperationCount(plannedOperations);
  const state: ChunkedExecutionState = {
    changes: { inserts: [], deletes: [], updates: [...repairs] },
    result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
    processed: 0,
    pushEcho: createPushEchoCounts(),
    superseded: false,
    checkpointRejected: false,
    protectedRemoteUids: new Set<string>(),
    updateFallbacks: 0,
    verificationUnsettled: 0,
  };

  await checkpointRun(state, { inserts: [], deletes: [], updates: repairs }, checkpoint);

  recordMirrorsOutsideDestination(state, existingMappings, plannedOperations);

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
      mappingsById,
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
    updateFallbacks: state.updateFallbacks,
    verificationUnsettled: state.verificationUnsettled,
  };
};

interface SyncCalendarOptions {
  userId: string;
  calendarId: string;
  provider: CalendarSyncProvider;
  readState: () => Promise<{
    localEvents: MaterializedSyncableEvent[];
    existingMappings: EventMapping[];
    remoteEvents: RemoteEvent[];
  }>;
  isCurrent: () => Promise<boolean>;
  flush: (changes: PendingChanges) => Promise<void>;
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
  reconciliationScope: ReconciliationScope;
}

interface SyncCalendarResult extends SyncResult {
  conflictsResolved: number;
  errors: string[];
}

const EMPTY_RESULT: SyncCalendarResult = { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0, conflictsResolved: 0, errors: [] };

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

const syncCalendar = async (options: SyncCalendarOptions): Promise<SyncCalendarResult> => {
  const {
    userId,
    calendarId,
    provider,
    readState,
    isCurrent,
    flush,
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
    ));

    const addCount = operations.filter((op) => op.type === "add" || op.type === "replace").length;
    const removeCount = operations.filter((op) => op.type === "remove" || op.type === "replace").length;

    wideEvent["operations.add_count"] = addCount;
    wideEvent["operations.remove_count"] = removeCount;
    wideEvent["operations.total"] = addCount + removeCount;
    wideEvent["stale_mappings.count"] = staleMappingIds.length;
    appendStaleReasonFields(wideEvent, staleReasonCounts);
    wideEvent["mapping_updates.count"] = mappingUpdates.length;

    if (
      operations.length === 0
      && staleMappingIds.length === 0
      && mappingUpdates.length === 0
    ) {
      wideEvent["outcome"] = "in-sync";
      wideEvent["flushed"] = false;
      wideEvent["events.added"] = 0;
      wideEvent["events.add_failed"] = 0;
      wideEvent["events.updated"] = 0;
      wideEvent["events.removed"] = 0;
      wideEvent["events.remove_failed"] = 0;
      return EMPTY_RESULT;
    }

    emitProgress("processing", localEvents.length, state.remoteEvents.length, {
      current: 0,
      total: getTotalOperationCount(operations),
    });

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
    wideEvent["events.updated"] = outcome.result.updated;
    wideEvent["events.removed"] = outcome.result.removed;
    wideEvent["events.remove_failed"] = outcome.result.removeFailed;
    wideEvent["events.conflicts_resolved"] = outcome.conflictsResolved;
    wideEvent["events.update_fallbacks"] = outcome.updateFallbacks;
    if (outcome.verificationUnsettled > 0) {
      wideEvent["stale_mappings.verification_unsettled_count"] = outcome.verificationUnsettled;
    }
    wideEvent["superseded"] = outcome.superseded;
    appendPushEchoFields(wideEvent, outcome.pushEcho);

    if (outcome.errors.length > 0) {
      wideEvent["operation_errors"] = outcome.errors.slice(0, OPERATION_ERROR_SAMPLE_SIZE);
      wideEvent["operation_errors.count"] = outcome.errors.length;
      wideEvent["operation_errors.truncated"] = outcome.errors.length > OPERATION_ERROR_SAMPLE_SIZE;
    }

    if (mappingUpdates.length > 0) {
      await timer.measure(
        "mapping_flush",
        () => flush({ deletes: [], inserts: [], updates: mappingUpdates }),
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

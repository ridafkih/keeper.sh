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
  /* Forward the source provider wholesale and override only what needs timing: an allowlist of
     named methods silently dropped verifyEventsExist, which turned every recipient-deleted
     mirror into a speculative delete that no destination could prove had removed anything. */
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

const GONE_STATUS_CODES = new Set([404, 410]);

const isUpdateTargetGone = (pushResult: PushResult | undefined): boolean =>
  typeof pushResult?.statusCode === "number" && GONE_STATUS_CODES.has(pushResult.statusCode);

const needsReplacementFallback = (pushResult: PushResult | undefined): boolean =>
  isUpdateTargetGone(pushResult);

/* The destination answered "come back later" - an outage, a throttle, or its copy moving under
   us - so nothing was learned about the object. */
const RETRYABLE_UPDATE_STATUS_CODES = new Set([408, 409, 412, 425, 429]);

/* The transport never delivered the request, so the destination never had a say. A timeout is
   asked of the module that throws it rather than listed here: the name a provider hands us is
   whatever its error class is called today, and a literal copied into this set drifts silently
   the moment that class is renamed. */
const TRANSPORT_ERROR_TYPES = new Set(["AbortError", "FetchError", "TypeError"]);

/* The destination refused US rather than the object, and unlike a refusal of the bytes that is
   not a claim about one verb's payload: an expired token or a revoked write privilege is the
   whole connection, so it is answered again on the very next cycle once the customer reconnects
   and there is nothing here for repetition to prove. It stays excluded so a read-only calendar
   does not accumulate evidence against a mapping that is not at fault. */
const REFUSED_WRITE_STATUS_CODES = new Set([401, 403]);

/* A batch that returned no sub-response for this index answered about no object: the request
   was carried to Google inside an envelope whose part for this mapping came back missing,
   truncated or renumbered, which is the transport failing for one index rather than a verdict.
   Only the status-less shape belongs here - the same error type over a real status line (a 200
   whose body had no event ID) is Google answering, and stays durable. */
const UNDELIVERED_BATCH_ERROR_TYPES = new Set(["GoogleBatchProtocolError"]);

/*
 * Escalating to a delete-then-add destroys a live event, so it needs positive evidence that the
 * DESTINATION answered about this object. Providers that know say so on the answer channel;
 * where they have not, a fabricated status of 0 is the absence of a status line rather than a
 * verdict, and a batch protocol hole names its own missing sub-response. Anything else - a
 * status the destination really sent, or a failure we generated ourselves before the request
 * left - is left to the rules below.
 */
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

/*
 * Which failures may count towards the replacement fallback. A result carrying no answer from
 * the destination never counts, however many cycles repeat it. Everything above is excluded
 * because escalating it would risk deleting a live event for nothing; a failure carrying no
 * status and no transport error is ours - an unaddressable target URL, a serializer - and will
 * repeat forever, so it is the one thing that must eventually escape.
 */
const isDurableUpdateFailure = (pushResult: PushResult | undefined): boolean => {
  if (learnedNothingFromDestination(pushResult)) {
    return false;
  }
  const { errorType, statusCode } = pushResult ?? {};
  if (typeof statusCode === "number") {
    if (isRetryableStatus(statusCode) || REFUSED_WRITE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    /* Every other status is the destination answering about this object, and a refusal of the
       bytes is durable too. The old exemption rested on the create verb carrying the same
       serialization into the same refusal, which is a CalDAV fact generalized to everyone:
       Outlook's create body is a strict SUBSET of its update body (buildOutlookUpdateBody adds
       body, location and recurrence), and Google PUTs buildUpdateBody with iCalUID deleted while
       it POSTs /events/import carrying it. The verbs share no validation surface, so a refusal
       repeated on the same mapping is evidence rather than a reason to stall forever. What it
       still may never license is a delete - the escape it earns runs through the verification
       read, in escapeRefusedUpdates. */
    return true;
  }
  return !isTransportError(errorType);
};

/*
 * Which escape a promoted failure has earned. A refusal the destination itself answered came back
 * from an identifier the destination could resolve, so the verification read on that identifier
 * means something and is the only escape allowed: nothing may be deleted to break a stall. A
 * failure carrying no answer at all is ours - an unaddressable target, a serializer - and the read
 * would have to trust the very identifier that failure says is unusable, so that one still escapes
 * by delete-then-add.
 */
const destinationAnsweredTheRefusal = (pushResult: PushResult | undefined): boolean => {
  if (pushResult?.destinationAnswer === "answered") {
    return true;
  }
  return typeof pushResult?.statusCode === "number" && pushResult.statusCode > 0;
};

/* Positive evidence is the same durable failure observed on this mapping in this many
   consecutive cycles, never the status of one request. */
const UPDATE_FAILURES_BEFORE_REPLACEMENT = 3;

const countUpdateFailure = (mapping: EventMapping | undefined): number =>
  (mapping?.consecutiveUpdateFailures ?? 0) + 1;

/* A mapping that finally accepted an update starts its evidence over. */
const clearedUpdateFailures = (mapping: EventMapping | undefined): { consecutiveUpdateFailures?: number } => {
  if (!mapping?.consecutiveUpdateFailures) {
    return {};
  }
  return { consecutiveUpdateFailures: 0 };
};

/* Carries the mapping forward unchanged apart from the counter: a failed update learned nothing
   about the version the destination still holds. */
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

/* A promotion goes to the one escape its evidence has earned: the verification read when the
   destination answered, the delete-then-add when the failure was ours and no read could tell us
   anything the failing identifier did not already. */
const recordPromotion = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
  destinations: {
    refused: Extract<SyncOperation, { type: "replace" }>[];
    unresolved: Extract<SyncOperation, { type: "replace" }>[];
  },
): void => {
  if (destinationAnsweredTheRefusal(pushResult)) {
    destinations.refused.push(operation);
    return;
  }
  destinations.unresolved.push(operation);
};

/* `added` is what an operator watches for duplicate churn on a create-only destination, so an
   update may only be counted there when the destination answered with a mirror the mapping does
   not name - the answer a provider gives when its update verb had to put a new object on the
   calendar. An edit answered under the uid the mapping already holds landed on the mirror we were
   already tracking, whatever id that mirror now carries: a re-keyed mapping repaired in place is
   exactly that, and counted as added it reads as a duplicate that never happened. The edit, the
   failures and the repaired identifier are all still reported. */
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

const processUpdateResults = (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  pushResults: PushResult[],
  mappingsById: Map<string, EventMapping>,
): {
  changes: PendingChanges;
  created: number;
  updateFailed: number;
  conflictsResolved: number;
  errors: OperationError[];
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  refused: Extract<SyncOperation, { type: "replace" }>[];
} => {
  const updates: PendingUpdate[] = [];
  const errors: OperationError[] = [];
  const unresolved: Extract<SyncOperation, { type: "replace" }>[] = [];
  const refused: Extract<SyncOperation, { type: "replace" }>[] = [];
  let created = 0;
  let updateFailed = 0;
  let conflictsResolved = 0;

  for (let index = 0; index < replacements.length; index++) {
    const operation = replacements[index];
    const pushResult = pushResults[index];

    if (!operation) {
      continue;
    }

    if (!pushResult?.success) {
      if (needsReplacementFallback(pushResult)) {
        unresolved.push(operation);
        continue;
      }
      const failingMapping = mappingsById.get(operation.staleMappingId);
      if (failingMapping && isDurableUpdateFailure(pushResult)) {
        const failures = countUpdateFailure(failingMapping);
        if (failures >= UPDATE_FAILURES_BEFORE_REPLACEMENT) {
          recordPromotion(operation, pushResult, { refused, unresolved });
          /* The evidence has been spent on this promotion. Leaving it standing would re-promote
             the same mapping every cycle for as long as the replacement keeps failing. */
          updates.push(toFailureCarry(failingMapping, 0));
          continue;
        }
        updates.push(toFailureCarry(failingMapping, failures));
      }
      updateFailed += 1;
      errors.push({
        type: "update",
        error: pushResult?.error ?? describeUpdateFailure(operation, pushResult),
        ...(pushResult?.errorType && { errorType: pushResult.errorType }),
        ...(typeof pushResult?.statusCode === "number" && { statusCode: pushResult.statusCode }),
      });
      continue;
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

  return { changes: { inserts: [], deletes: [], updates }, created, updateFailed, conflictsResolved, errors, unresolved, refused };
};

/* A delete reporting success is not evidence that anything left the destination: Outlook maps a
   404 to success. Only the provider's own observation of a removal licenses a recreate, or a
   still-live event gets duplicated on a customer calendar. */
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

    /* A bare success removed nothing -- the destination held no object at that identifier. The
       mirror may still be live under another key, so this is neither a removal to report nor a
       mapping to forget. Only a caller that must earn its recreate asks for that evidence. */
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
  /* Mirrors the verification could not settle. Without it the caller cannot tell a run that
     restored nothing because nothing was missing from one that restored nothing because it never
     learned anything: both report all zeroes and no errors. */
  verificationUnsettled: number;
}

interface RunResult {
  changes: PendingChanges;
  result: SyncResult;
  conflictsResolved: number;
  errors: OperationError[];
  pushEcho?: PushEchoCounts;
}

interface UpdateRunResult {
  runResult: RunResult;
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  /* Promotions the destination itself answered. They are kept apart from `unresolved` because the
     only escape they may take is the verification read: a delete issued to break their stall would
     destroy a mirror the destination just proved it still holds. */
  refused: Extract<SyncOperation, { type: "replace" }>[];
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

const getErrorTypeName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return "UnknownError";
};

const isRunLevelAbort = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === "AbortError" || error.name === "TimeoutError");

/* A provider that throws carries its numeric status on the error rather than on any returned
   result - Google's whole-batch non-2xx is a throw - so a thrown 429 or 503 must be read off the
   error or it would classify as the status-less failure it is not. */
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

/* One failed batch is one failure. The run never reached a single object, so it can say nothing
   about any individual mapping: fanning it out into a result per mapping would manufacture
   per-mapping evidence out of an outage, and a status-less throw stays unknown either way. */
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

/* Nothing was learned about any mapping, so every mapping is carried forward untouched: no
   counter moves, and nothing escalates towards a delete-then-add. */
const failedUpdateRun = (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  runFailure: OperationError,
): UpdateRunResult => ({
  runResult: {
    changes: { inserts: [], deletes: [], updates: [] },
    result: { added: 0, addFailed: replacements.length, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [runFailure],
  },
  refused: [],
  unresolved: [],
});

const executeUpdateRun = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  updateEvents: NonNullable<CalendarSyncProvider["updateEvents"]>,
  mappingsById: Map<string, EventMapping>,
): Promise<UpdateRunResult> => {
  const updates: EventUpdate[] = replacements.map((operation) => ({
    deleteId: operation.deleteId,
    event: operation.event,
  }));
  const outcome = await runUpdateEvents(updateEvents, updates);
  if ("runFailure" in outcome) {
    return failedUpdateRun(replacements, outcome.runFailure);
  }
  const { pushResults } = outcome;
  const { created, updateFailed, conflictsResolved, changes, errors, unresolved, refused } = processUpdateResults(
    replacements,
    pushResults,
    mappingsById,
  );
  const pushEcho = createPushEchoCounts();
  tallyPushEcho(pushEcho, pushResults);
  return {
    runResult: {
      changes,
      result: { added: created, addFailed: updateFailed, removed: 0, removeFailed: 0 },
      conflictsResolved,
      errors,
      pushEcho,
    },
    refused,
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
    if (runResult.changes.updates) {
      state.changes.updates = [...(state.changes.updates ?? []), ...runResult.changes.updates];
    }
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

const replaceViaDeleteThenAdd = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsByRemoteIdentity: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  requiresRemovalEvidence: boolean,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  /* A promoted update failure has no reconciliation behind it, so it must earn the recreate with
     the same evidence recreateMissingMirrors demands rather than a bare delete success. When the
     delete removed nothing we cannot tell a mirror the recipient deleted from one mapped under a
     stale identifier, and guessing either way destroys or duplicates a real event -- so we leave
     it to the next reconcile, which has the listing and the verification to settle it. */
  const licensesRecreate = (deleteResult: DeleteResult | undefined): boolean => {
    if (requiresRemovalEvidence) {
      return didRemoveObject(deleteResult);
    }
    return deleteResult?.success === true;
  };

  const removes: Extract<SyncOperation, { type: "remove" }>[] = replacements.map((operation) => ({
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
      removed: processedRemoves.removed,
      removeFailed: processedRemoves.removeFailed,
    },
    conflictsResolved: 0,
    errors: processedRemoves.errors,
  }, false);

  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const unchanged: OperationError[] = [];
  for (let index = 0; index < replacements.length; index++) {
    const replacement = replacements[index];
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

    /* Nothing was updated, nothing left the destination and nothing was put back: the mapping is
       exactly as stale as before. Reported as a success it resets the failure count and the
       promotion restarts from scratch every cycle, so it has to surface as the failure it is. */
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
      result: { added: 0, addFailed: unchanged.length, removed: 0, removeFailed: 0 },
      conflictsResolved: 0,
      errors: unchanged,
    }, false);
  }

  if (adds.length > 0) {
    const addResult = await executeAddRun(adds, calendarId, provider);
    mergeRunResult(state, addResult);
    if (!(await checkpointRun(state, addResult.changes, checkpoint))) {
      return false;
    }
  }

  return true;
};

/* Absence has exactly two admissible proofs: a verification read that positively reports the
   object gone, or a delete that reports it removed something. Nothing else — no status code, no
   bare delete success — may stand in for either. */
const isEventPresence = (entry: EventPresence | RemoteEvent): entry is EventPresence =>
  "status" in entry;

/* What the read established about each mirror it was asked about. An identifier the read located
   under a different id was not lost -- the destination re-keyed it in place -- so the observation is
   kept rather than collapsed away, because it is the only thing that can repair the mapping. */
interface MirrorVerdicts {
  absent: Set<string>;
  located: Map<string, RemoteEvent>;
  /* Identifiers the read found outside the calendar this sync owns, carrying the object it saw.
     They are the customer's only copy, so they may never license a create or a delete -- but they
     are an observation of a live item, and dropping them is what froze the mirror forever. */
  elsewhere: Map<string, RemoteEvent>;
  /* Identifiers the read never settled: it failed, it answered "unknown", it called the mirror
     present without handing back the object that says which one it saw, or it stayed silent about
     the identifier altogether. They license neither a create nor a delete, and a run that keeps
     them to itself is byte-identical to a healthy one. */
  unsettled: Set<string>;
  unsettledReason: string;
}

const UNSETTLED_BY_REPORT = "the verification read returned no verdict for it";

const noVerdicts = (): MirrorVerdicts => ({
  absent: new Set(),
  elsewhere: new Map(),
  located: new Map(),
  unsettled: new Set(),
  unsettledReason: UNSETTLED_BY_REPORT,
});

const verdictsFromPresenceReport = (report: EventPresence[]): MirrorVerdicts => {
  const verdicts = noVerdicts();
  for (const presence of report) {
    if (presence.status === "absent") {
      verdicts.absent.add(presence.identifier);
      continue;
    }
    /* "elsewhere" found the mirror outside the calendar this sync owns, so it may never license a
       create. It is still a live item the read identified, and a Graph item id addresses the item
       mailbox-wide, so it is kept in its own bucket: repairable, never creatable. */
    if (presence.status === "elsewhere" && presence.event) {
      verdicts.elsewhere.set(presence.identifier, presence.event);
      continue;
    }
    if (presence.status === "present" && presence.event) {
      verdicts.located.set(presence.identifier, presence.event);
    }
  }
  return verdicts;
};

/* An object handed back under an identifier we never asked about may be the very object we did ask
   about wearing a new key: a move or an immutable-id preference renames it. Omission then proves
   nothing, so the whole answer stays unproven rather than licensing a create. */
const answersOnlyAboutIdentifiers = (identifiers: string[], found: RemoteEvent[]): boolean => {
  const asked = new Set(identifiers);
  for (const event of found) {
    if (!asked.has(event.deleteId) && !asked.has(event.uid)) {
      return false;
    }
  }
  return true;
};

/* Outlook answers with the events the read actually found and throws when the read itself failed,
   so an identifier missing from a returned listing is one the destination positively does not hold. */
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

/* A three-valued report answers about an identifier only when it says something that decides it:
   "unknown" decides nothing, and "present" without the object cannot say whether the mirror is the
   one the mapping names or a re-keyed sibling, so neither settles anything. */
const settledIdentifiersFromPresenceReport = (report: EventPresence[]): Set<string> => {
  const settled = new Set<string>();
  for (const presence of report) {
    if (presence.status === "unknown") {
      continue;
    }
    /* A verdict that names a location without handing back the object cannot be acted on at all:
       it repairs nothing and creates nothing, so it decides no more than "unknown" does. */
    if ((presence.status === "present" || presence.status === "elsewhere") && !presence.event) {
      continue;
    }
    settled.add(presence.identifier);
  }
  return settled;
};

/* A listing settles an identifier by handing back the object under it, or -- when the whole answer
   is about the identifiers we asked about -- by omitting it from a listing that proves absence. */
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
    /* The run itself was cancelled, not the read: swallowing it here lets execution walk on to
       pushEvents and POST a create after cancellation, which on Outlook is a permanent duplicate. */
    if (isRunLevelAbort(error)) {
      throw error;
    }
    // A read that failed tells us nothing about the object, so it leaves every identifier unsettled.
    return { readFailure: getErrorMessage(error) };
  }
};

const verifyMirrors = async (
  targets: EventVerificationTarget[],
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
): Promise<MirrorVerdicts> => {
  const identifiers = targets.map((target) => target.deleteId);
  const read = await readVerification(verifyEventsExist, targets);
  if ("readFailure" in read) {
    return {
      absent: new Set(),
      elsewhere: new Map(),
      located: new Map(),
      unsettled: new Set(identifiers),
      unsettledReason: read.readFailure,
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

  /* A three-valued report answers every identifier it was asked about, so whatever it did not call
     absent stays unproven. A listing of the events actually found proves absence by omission. */
  if (presences.length > 0) {
    const verdicts = verdictsFromPresenceReport(presences);
    return {
      ...verdicts,
      unsettled: unsettledIdentifiers(identifiers, settledIdentifiersFromPresenceReport(presences)),
    };
  }
  const absent = absencesFromFoundEvents(identifiers, found);
  return {
    absent,
    elsewhere: new Map(),
    located: new Map(),
    unsettled: unsettledIdentifiers(identifiers, settledIdentifiersFromFoundEvents(found, absent)),
    unsettledReason: UNSETTLED_BY_REPORT,
  };
};

/* The plan called this mirror missing, and the read answered with the object itself: under a new id
   because the destination re-keyed it, under the same id because the listing that planned the run
   simply did not see it, or in another folder the customer dragged it into. Every one of those is a
   live object, so the ending is the same -- update it in place by the id the read actually saw.
   Nothing else in the run carries this observation: without it the mapping keeps naming whatever it
   held, the pending edit never lands, and the identical dead plan is recomputed every cycle. */
const survivingMirror = (
  verdicts: MirrorVerdicts,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): RemoteEvent | null =>
  verdicts.located.get(replacement.deleteId)
    ?? verdicts.elsewhere.get(replacement.deleteId)
    ?? null;

/* Carries the mapping forward with the id the read actually saw, so the repair survives even when
   the update that follows it does not land. The content hash stays as it was: the pending edit has
   not been accepted yet, and claiming it had would drop the customer's change silently. */
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

/* A repair the update run already recorded carries the same identifier plus the accepted content
   hash, so only the mappings the run said nothing about still need theirs written back. */
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
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
  });
  return unrecorded;
};

/* The identity comes from what the read saw in the destination calendar, never from the push's own
   echo: the echo answers about the request that was just sent, so letting it overwrite the observed
   id would put an unobserved identifier on the mapping and lose the repair the read paid for. */
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

/* Delivering a pending edit to a mirror that was only re-keyed creates nothing, so it must not be
   counted as an add: that number is what an operator watches for duplicate churn on a create-only
   provider, and a repair reported as a create is a duplicate that never happened. The failures and
   the repaired identifier itself are still reported. */
const withoutAddCredit = (runResult: RunResult): RunResult => ({
  ...runResult,
  result: { ...runResult.result, added: 0 },
});

/* Deliver the pending edit to the id the read located, in this run: the mapping repair alone would
   leave the mirror a cycle behind the source, and a delete-then-add would duplicate it permanently
   on a create-only provider. */
const updateRelocatedMirrors = async (
  relocated: Extract<SyncOperation, { type: "replace" }>[],
  repairs: PendingUpdate[],
  locatedByMappingId: Map<string, RemoteEvent>,
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

  const { runResult } = await executeUpdateRun(relocated, updateEvents, mappingsById);
  const delivered = withLocatedIdentity(runResult.changes.updates ?? [], locatedByMappingId);
  const repairedRunResult: RunResult = {
    ...withoutAddCredit(runResult),
    changes: { ...runResult.changes, updates: delivered },
  };
  mergeRunResult(state, repairedRunResult);
  const unrecorded = mergeRepairsNotAlreadyRecorded(state, repairs, delivered);
  for (const replacement of relocated) {
    state.protectedRemoteUids.add(replacement.uid);
  }
  return checkpointRun(state, {
    deletes: runResult.changes.deletes,
    inserts: runResult.changes.inserts,
    updates: [...delivered, ...unrecorded],
  }, checkpoint);
};

/* A mirror the read could not settle is a restore that did not happen, and the counters alone say
   exactly what a healthy run says. Counting it and naming its mapping is the only thing that lets
   an operator tell a customer's mirror that is never coming back from a calendar with nothing to do.
   Naming does not license acting: unsettled still means no create and no delete. */
const recordUnsettledMirrors = (
  state: ChunkedExecutionState,
  verdicts: MirrorVerdicts,
  replacements: Extract<SyncOperation, { type: "replace" }>[],
): void => {
  for (const replacement of replacements) {
    if (!verdicts.unsettled.has(replacement.deleteId)) {
      continue;
    }
    state.verificationUnsettled += 1;
    state.errors.push({
      type: "update",
      error: `verification could not settle the mirror for mapping ${replacement.staleMappingId}: ${verdicts.unsettledReason}`,
    });
  }
};

/* The mirror is alive at the very identity the update just addressed, so there is nothing to
   recreate, nothing to repair, and nothing that would license deleting it to force an escape. The
   stall is real and it is now named: an operator can see which mapping is frozen at stale content,
   which is the whole difference between a mirror that is permanently wrong and one that is wrong
   in silence. */
const recordUnrepairableRefusal = (
  state: ChunkedExecutionState,
  replacement: Extract<SyncOperation, { type: "replace" }>,
  reason: string,
): void => {
  state.errors.push({
    type: "update",
    error: `the destination keeps refusing the update for mapping ${replacement.staleMappingId}: ${reason}`,
  });
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 1, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

/* The read handed back the object under the same key and uid the refused update already used, so
   redelivering it would only buy the identical refusal one more time. */
const isTheSameMirror = (
  located: RemoteEvent,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): boolean => located.deleteId === replacement.deleteId && located.uid === replacement.uid;

/* The recipient really deleted the mirror, so there is nothing left for a delete to remove and its
   answer cannot tell that apart from a stale identifier. The verification read can, so on a
   destination that verifies we recreate on its word alone and never issue a speculative delete. */
const resolveVerifiedMirrors = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
  updateAlreadyRefused = false,
): Promise<boolean> => {
  /* The replace already carries the uid the mapping holds; dropping it here is what left Outlook
     unable to ever say absent, so a mirror the recipient deleted was never restored. */
  const targets = replacements.map((operation) => ({
    deleteId: operation.deleteId,
    uid: operation.uid,
  }));
  const verdicts = await verifyMirrors(targets, verifyEventsExist);
  recordUnsettledMirrors(state, verdicts, replacements);
  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const relocated: Extract<SyncOperation, { type: "replace" }>[] = [];
  const repairs: PendingUpdate[] = [];
  const locatedByMappingId = new Map<string, RemoteEvent>();
  for (const replacement of replacements) {
    const located = survivingMirror(verdicts, replacement);
    if (located) {
      if (updateAlreadyRefused && isTheSameMirror(located, replacement)) {
        recordUnrepairableRefusal(
          state,
          replacement,
          `its mirror is still present at ${located.deleteId}, so the stale copy stands`,
        );
        continue;
      }
      const mapping = mappingsById.get(replacement.staleMappingId);
      if (mapping) {
        repairs.push(toRelocationRepair(mapping, located.deleteId, located.uid));
      }
      locatedByMappingId.set(replacement.staleMappingId, located);
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
  mergeRunResult(state, addResult);
  return checkpointRun(state, addResult.changes, checkpoint);
};

const recreateMissingMirrors = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
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
    );
  }

  const deleteResults = await provider.deleteEvents(replacements.map((operation) => operation.deleteId));
  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  const errors: OperationError[] = [];
  let removed = 0;
  let removeFailed = 0;

  for (let index = 0; index < replacements.length; index++) {
    const replacement = replacements[index];
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

    /* The delete found nothing at this identifier. The mirror may simply be mapped under a stale
       identifier while it is still live, so recreating it would duplicate a customer's event. */
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
    result: { added: 0, addFailed: 0, removed, removeFailed },
    conflictsResolved: 0,
    errors,
  }, false);

  if (adds.length === 0) {
    return true;
  }

  const addResult = await executeAddRun(adds, calendarId, provider);
  mergeRunResult(state, addResult);
  return checkpointRun(state, addResult.changes, checkpoint);
};

/* The escape for a refusal the destination answered on the same mapping cycle after cycle. It may
   only ever end in a recreate of a mirror the read proved absent, or in a named failure: a delete
   would destroy the customer's only copy to make a stall stop repeating, which is the trade this
   whole path exists to refuse. A destination that cannot verify has no proof to offer either way,
   so its mappings are named rather than acted on. */
const escapeRefusedUpdates = async (
  refused: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  mappingsById: Map<string, EventMapping>,
  state: ChunkedExecutionState,
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

  return await resolveVerifiedMirrors(
    refused,
    calendarId,
    provider,
    verifyEventsExist,
    mappingsById,
    state,
    checkpoint,
    true,
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

    if (present.length > 0) {
      const {
        runResult,
        refused: refusedUpdates,
        unresolved: unresolvedUpdates,
      } = await executeUpdateRun(
        present,
        updateEvents,
        mappingsById,
      );
      unresolved = unresolvedUpdates;
      refused = refusedUpdates;
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
        checkpoint,
      );
      if (!escaped) {
        return;
      }
    }

    if (missing.length > 0) {
      const restored = await recreateMissingMirrors(
        missing,
        calendarId,
        provider,
        mappingsById,
        state,
        checkpoint,
      );
      if (!restored) {
        return;
      }
    }

    if (unresolved.length > 0) {
      const recovered = await replaceViaDeleteThenAdd(
        unresolved,
        calendarId,
        provider,
        mappingsByRemoteIdentity,
        state,
        true,
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

/* A remove and a remoteMissing replace naming the same mirror uid are one object seen twice: the
   destination re-keyed the mirror, so the windowed listing offered the live copy as an unmapped
   orphan while the mapping's dead identifier read as gone. Removes run before replaces, so carrying
   out that plan DELETEs the customer's live event and POSTs a fresh one on a create-only provider,
   destroying its reminders, categories and RSVP state. */
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

/* The plan itself was computed against an identity the destination no longer uses, so it is the
   identity that gets acted on, not the plan: the mapping learns the id the listing actually
   returned, the orphan remove and its paired replace are dropped, and the next cycle -- which now
   matches the mapping to the live event -- delivers the pending edit as an ordinary update. */
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
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
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

  /* The repaired identifier only helps the customer once it is written down: without this flush the
     mapping keeps naming the dead id and the same destructive plan is recomputed every cycle. */
  await checkpointRun(state, { inserts: [], deletes: [], updates: repairs }, checkpoint);

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

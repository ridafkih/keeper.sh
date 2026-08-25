import type {
  DeleteResult,
  EventAvailability,
  EventPresence,
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
  const { getRemoteEventsByIds, getSyncDiagnostics, getThrottleMetrics, updateEvents } = provider;
  return {
    deleteEvents: (eventIds) => timer.measure("provider_delete", () => provider.deleteEvents(eventIds)),
    listRemoteEvents: (options) => provider.listRemoteEvents(options),
    pushEvents: (events) => timer.measure("provider_push", () => provider.pushEvents(events)),
    ...(getRemoteEventsByIds && { getRemoteEventsByIds: (eventIds: string[]) => timer.measure("provider_push", () => getRemoteEventsByIds(eventIds)) }),
    ...(updateEvents && { updateEvents: (updates: EventUpdate[]) => timer.measure("provider_push", () => updateEvents(updates)) }),
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

/*
 * A destination that can be read back records its own coercion as the baseline at write time, so
 * anything a mapping has no baseline for and that contradicts local intent came from somebody
 * else. One that cannot be read back proves nothing about what it stored, and repairing on that
 * guess is what puts a whole calendar into permanent churn.
 */
const canObserveStoredForm = (provider: CalendarSyncProvider): boolean =>
  typeof provider.getRemoteEventsByIds === "function";

/*
 * What the destination was seen holding after a write. An absent field means the capture yielded
 * nothing for it, which is not the same as observing that the provider stores no such value.
 */
interface CapturedRemoteForm {
  availability?: EventAvailability;
  contentHash?: string;
  endTime?: Date;
  startTime?: Date;
}

const NOTHING_CAPTURED: CapturedRemoteForm = {};

/*
 * Google and Outlook compute the form they actually stored and hand it back on the write, so
 * that echo stands in for the read-back it replaces. It has to carry everything that read-back
 * would have established — times and availability as well as the content hash — because a write
 * that records no time baseline leaves the next pass comparing the destination against local
 * intent, which is what makes an event churn forever.
 */
const echoedStoredForm = (pushResult: PushResult): CapturedRemoteForm => {
  const { storedAvailability, storedContentHash, storedEndTime, storedStartTime } = pushResult;
  if (typeof storedContentHash !== "string") {
    return NOTHING_CAPTURED;
  }
  return {
    contentHash: storedContentHash,
    ...(storedAvailability && { availability: storedAvailability }),
    ...(storedEndTime && { endTime: storedEndTime }),
    ...(storedStartTime && { startTime: storedStartTime }),
  };
};

const observedRemoteForm = (remoteEvent: RemoteEvent): CapturedRemoteForm => ({
  endTime: remoteEvent.endTime,
  startTime: remoteEvent.startTime,
  ...(typeof remoteEvent.editableAvailability === "string"
    && { availability: remoteEvent.editableAvailability }),
  ...(typeof remoteEvent.editableContentHash === "string"
    && { contentHash: remoteEvent.editableContentHash }),
});

const resolveCapturedForm = (
  pushResult: PushResult,
  formsByRemoteIdentity: ReadonlyMap<string, CapturedRemoteForm>,
): CapturedRemoteForm | undefined => {
  for (const identity of [pushResult.deleteId, pushResult.remoteId]) {
    const captured = identity && formsByRemoteIdentity.get(identity);
    if (captured) {
      return captured;
    }
  }
  return globalThis.undefined;
};

const readRemoteEventsForCapture = async (
  getRemoteEventsByIds: NonNullable<CalendarSyncProvider["getRemoteEventsByIds"]>,
  lookupIds: string[],
): Promise<RemoteEvent[] | null> => {
  try {
    return await getRemoteEventsByIds(lookupIds);
  } catch {
    return null;
  }
};

/*
 * Only a COMPLETE echo can stand in for the read-back. A partial one would skip the read while
 * leaving the times and availability unrecorded, and an unrecorded baseline falls back to
 * comparing against local intent -- which is the churn this whole comparison exists to stop.
 */
const echoReplacesTheReadBack = (pushResult: PushResult): boolean =>
  typeof pushResult.storedContentHash === "string"
    && Boolean(pushResult.storedAvailability)
    && Boolean(pushResult.storedStartTime)
    && Boolean(pushResult.storedEndTime);

const collectCaptureLookupIds = (pushResults: PushResult[]): string[] => {
  const lookupIds: string[] = [];
  for (const pushResult of pushResults) {
    const lookupId = pushResult.deleteId ?? pushResult.remoteId;
    if (!echoReplacesTheReadBack(pushResult) && pushResult.success && lookupId) {
      lookupIds.push(lookupId);
    }
  }
  return lookupIds;
};

const captureRemoteForms = async (
  pushResults: PushResult[],
  getRemoteEventsByIds: CalendarSyncProvider["getRemoteEventsByIds"],
): Promise<CapturedRemoteForm[]> => {
  const uncaptured = pushResults.map((pushResult) => echoedStoredForm(pushResult));
  if (!getRemoteEventsByIds) {
    return uncaptured;
  }

  const lookupIds = collectCaptureLookupIds(pushResults);
  if (lookupIds.length === 0) {
    return uncaptured;
  }

  const remoteEvents = await readRemoteEventsForCapture(getRemoteEventsByIds, lookupIds);
  if (remoteEvents === null) {
    return uncaptured;
  }

  const formsByRemoteIdentity = new Map<string, CapturedRemoteForm>();
  for (const remoteEvent of remoteEvents) {
    const form = observedRemoteForm(remoteEvent);
    formsByRemoteIdentity.set(remoteEvent.uid, form);
    formsByRemoteIdentity.set(remoteEvent.deleteId, form);
  }

  return pushResults.map((pushResult): CapturedRemoteForm => {
    const captured = resolveCapturedForm(pushResult, formsByRemoteIdentity);
    if (captured) {
      return captured;
    }
    return echoedStoredForm(pushResult);
  });
};

/*
 * A settled form outranks the capture. It is the form the destination was seen holding for the
 * copy this write replaces, and the write puts back the same text, so it is where the capture's
 * form ends up once the destination finishes storing it. Recording the capture instead is what
 * repairs the same event on every pass forever.
 */
const resolveRecordedForm = (
  operation: { recordedContentHash?: string; settledContentHash?: string },
  captured: string | undefined,
): string | undefined => {
  if (typeof operation.settledContentHash === "string") {
    return operation.settledContentHash;
  }
  if (typeof captured === "string") {
    return captured;
  }
  return operation.recordedContentHash;
};

/*
 * A replaced mapping's recorded form is the last thing the provider was seen to hold, so a
 * capture that came back empty inherits it: recording no baseline would let the next owner
 * edit be adopted as truth instead of repaired.
 */
const resolveInsertedContentHash = (
  operation: Extract<SyncOperation, { type: "add" }>,
  captured: string | undefined,
): string | null => {
  const recorded = resolveRecordedForm(operation, captured);
  if (typeof recorded === "string") {
    return recorded;
  }
  return null;
};

/*
 * The form this write is repairing away from, so the next pass can recognise our own rewrite of
 * it. Absent when the write proves nothing about the form that comes back, and the flush clears
 * whatever the row held: an unproven form must never be adopted.
 */
const repairedFromContentHashRecord = (
  operation: { repairedFromContentHash?: string },
): { remoteContentHashRepairedFrom?: string } => {
  const { repairedFromContentHash } = operation;
  if (typeof repairedFromContentHash !== "string") {
    return {};
  }
  return { remoteContentHashRepairedFrom: repairedFromContentHash };
};

const capturedContentHashUpdate = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  captured: string | undefined,
): { remoteContentHash?: string } => {
  const recorded = resolveRecordedForm(operation, captured);
  if (typeof recorded !== "string") {
    return {};
  }
  return { remoteContentHash: recorded };
};

/*
 * A capture that observed nothing proves nothing about the availability the destination holds, so
 * the baseline the operation carries is written back unchanged. Taking the empty capture instead
 * nulls a good baseline, and the next pass then compares the destination against local intent,
 * which churns. The flush coalesces the remaining null so a mapping is never downgraded either.
 */
const resolveRecordedAvailability = (
  operation: { recordedAvailability?: EventAvailability },
  captured: CapturedRemoteForm,
): EventAvailability | null => {
  if (captured.availability) {
    return captured.availability;
  }
  return operation.recordedAvailability ?? null;
};

/* Both instants or neither: half a baseline says nothing about the span the destination holds. */
const resolveRecordedTimes = (
  operation: { recordedEndTime?: Date; recordedStartTime?: Date },
  captured: CapturedRemoteForm,
): { remoteEndTime: Date | null; remoteStartTime: Date | null } => {
  if (captured.startTime && captured.endTime) {
    return { remoteEndTime: captured.endTime, remoteStartTime: captured.startTime };
  }
  if (operation.recordedStartTime && operation.recordedEndTime) {
    return { remoteEndTime: operation.recordedEndTime, remoteStartTime: operation.recordedStartTime };
  }
  return { remoteEndTime: null, remoteStartTime: null };
};

const processAddResults = (
  addOperations: Extract<SyncOperation, { type: "add" }>[],
  pushResults: PushResult[],
  calendarId: string,
  capturedForms: CapturedRemoteForm[],
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
    const capturedForm = capturedForms[index] ?? NOTHING_CAPTURED;
    changes.inserts.push({
      eventStateId: operation.event.eventStateId ?? operation.event.id,
      sourceCalendarId: operation.event.calendarId,
      syncEventId: operation.event.id,
      calendarId,
      destinationEventUid: pushResult.remoteId,
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId,
      syncEventHash: createSyncEventContentHash(operation.event),
      remoteContentHash: resolveInsertedContentHash(operation, capturedForm.contentHash),
      ...repairedFromContentHashRecord(operation),
      remoteAvailability: resolveRecordedAvailability(operation, capturedForm),
      ...resolveRecordedTimes(operation, capturedForm),
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

/* The transport never delivered the request, so the destination never had a say. */
const TRANSPORT_ERROR_TYPES = new Set(["AbortError", "FetchError", "TimeoutError", "TypeError"]);

/* The destination refused us rather than the object: a delete-then-add carries the same bytes
   with the same rights into the same refusal - RFC 4791 answers 403 for both a payload
   precondition and a missing DAV privilege - so escalating could only destroy the customer's
   event without putting it back. */
const REFUSED_WRITE_STATUS_CODES = new Set([401, 403]);

/* The destination refused the PAYLOAD. Whether a create can still succeed is not something the
   status can say: it depends on what the create verb does with the same bytes. CalDAV PUTs them
   to a freshly derived href with its own preconditions, so it can; Google and Outlook carry the
   same serialization to the same collection, so it cannot. Only the provider knows. */
const PAYLOAD_REFUSAL_STATUS_CODES = new Set([400, 413, 415, 422, 431]);

const isTransportError = (errorType: string | undefined): boolean => {
  if (!errorType) {
    return false;
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
 * Which failures may count towards the replacement fallback. Everything above is excluded
 * because escalating it would risk deleting a live event for nothing; a failure carrying no
 * status and no transport error is ours - an unaddressable target URL, a serializer - and will
 * repeat forever, so it is the one thing that must eventually escape.
 */
const isDurableUpdateFailure = (
  pushResult: PushResult | undefined,
  createEscapesPayloadRefusal: boolean,
): boolean => {
  const { errorType, statusCode } = pushResult ?? {};
  if (typeof statusCode === "number") {
    if (isRetryableStatus(statusCode) || REFUSED_WRITE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    if (PAYLOAD_REFUSAL_STATUS_CODES.has(statusCode)) {
      return createEscapesPayloadRefusal;
    }
    return true;
  }
  return !isTransportError(errorType);
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
  capturedForms: CapturedRemoteForm[],
  mappingsById: Map<string, EventMapping>,
  createEscapesPayloadRefusal: boolean,
): {
  changes: PendingChanges;
  updated: number;
  updateFailed: number;
  conflictsResolved: number;
  errors: OperationError[];
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
} => {
  const updates: PendingUpdate[] = [];
  const errors: OperationError[] = [];
  const unresolved: Extract<SyncOperation, { type: "replace" }>[] = [];
  let updated = 0;
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
      if (failingMapping && isDurableUpdateFailure(pushResult, createEscapesPayloadRefusal)) {
        const failures = countUpdateFailure(failingMapping);
        if (failures >= UPDATE_FAILURES_BEFORE_REPLACEMENT) {
          unresolved.push(operation);
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

    updated += 1;
    if (pushResult.conflictResolved) {
      conflictsResolved += 1;
    }
    const capturedForm = capturedForms[index] ?? NOTHING_CAPTURED;
    updates.push({
      ...clearedUpdateFailures(mappingsById.get(operation.staleMappingId)),
      deleteIdentifier: pushResult.deleteId ?? pushResult.remoteId ?? operation.deleteId,
      ...(pushResult.remoteId && { destinationEventUid: pushResult.remoteId }),
      endTime: operation.event.endTime,
      id: operation.staleMappingId,
      ...capturedContentHashUpdate(operation, capturedForm.contentHash),
      ...repairedFromContentHashRecord(operation),
      remoteAvailability: resolveRecordedAvailability(operation, capturedForm),
      ...resolveRecordedTimes(operation, capturedForm),
      startTime: operation.event.startTime,
      syncEventHash: createSyncEventContentHash(operation.event),
      syncEventId: operation.event.id,
    });
  }

  return { changes: { inserts: [], deletes: [], updates }, updated, updateFailed, conflictsResolved, errors, unresolved };
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
  updateFallbacks: number;
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
}

const executeAddRun = async (
  adds: Extract<SyncOperation, { type: "add" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
): Promise<RunResult> => {
  const addEvents = adds.map((op) => op.event);
  const pushResults = await provider.pushEvents(addEvents);
  const captures = await captureRemoteForms(pushResults, provider.getRemoteEventsByIds);
  const { added, addFailed, conflictsResolved, changes, errors } = processAddResults(adds, pushResults, calendarId, captures);
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
  unresolved: [],
});

const executeUpdateRun = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  updateEvents: NonNullable<CalendarSyncProvider["updateEvents"]>,
  getRemoteEventsByIds: CalendarSyncProvider["getRemoteEventsByIds"],
  mappingsById: Map<string, EventMapping>,
  createEscapesPayloadRefusal: boolean,
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
  const captures = await captureRemoteForms(pushResults, getRemoteEventsByIds);
  const { updated, updateFailed, conflictsResolved, changes, errors, unresolved } = processUpdateResults(
    replacements,
    pushResults,
    captures,
    mappingsById,
    createEscapesPayloadRefusal,
  );
  const pushEcho = createPushEchoCounts();
  tallyPushEcho(pushEcho, pushResults);

  return {
    runResult: {
      changes,
      result: { added: updated, addFailed: updateFailed, removed: 0, removeFailed: 0 },
      conflictsResolved,
      errors,
      pushEcho,
    },
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

/* A delete reporting success is not evidence that anything left the destination: Outlook maps a
   404 to success. Only the provider's own observation of a removal licenses a recreate, or a
   still-live event gets duplicated on a customer calendar. */
const didRemoveObject = (deleteResult: DeleteResult | undefined): boolean => {
  if (deleteResult?.success !== true) {
    return false;
  }
  return deleteResult.removedObject === true;
};

/*
 * Every baseline has to survive the fallback. Without the recorded one the add that follows the
 * delete records none, and the next owner edit is adopted as truth; without the settled one it
 * records what the write echoes back, and repairs the same event again on the next pass; without
 * the form this repair wrote over, the next pass cannot tell our own rewrite of it from an edit.
 */
const replacedFormFields = (
  replacement: Extract<SyncOperation, { type: "replace" }>,
): {
  recordedAvailability?: EventAvailability;
  recordedContentHash?: string;
  recordedEndTime?: Date;
  recordedStartTime?: Date;
  repairedFromContentHash?: string;
  settledContentHash?: string;
} => ({
  ...(replacement.recordedAvailability && { recordedAvailability: replacement.recordedAvailability }),
  ...(replacement.recordedEndTime && replacement.recordedStartTime && {
    recordedEndTime: replacement.recordedEndTime,
    recordedStartTime: replacement.recordedStartTime,
  }),
  ...(typeof replacement.recordedContentHash === "string"
    && { recordedContentHash: replacement.recordedContentHash }),
  ...(typeof replacement.repairedFromContentHash === "string"
    && { repairedFromContentHash: replacement.repairedFromContentHash }),
  ...(typeof replacement.settledContentHash === "string"
    && { settledContentHash: replacement.settledContentHash }),
});

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
    const replacement = replacements[index];
    if (replacement && licensesRecreate(deleteResults[index])) {
      adds.push({
        event: replacement.event,
        staleMappingId: replacement.staleMappingId,
        type: "add",
        ...replacedFormFields(replacement),
      });
    }
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

const absencesFromPresenceReport = (report: EventPresence[]): Set<string> => {
  const absent = new Set<string>();
  for (const presence of report) {
    if (presence.status === "absent") {
      absent.add(presence.identifier);
    }
  }
  return absent;
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

const readVerification = async (
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  identifiers: string[],
): Promise<EventPresence[] | RemoteEvent[] | null> => {
  try {
    return await verifyEventsExist(identifiers);
  } catch {
    // A read that failed tells us nothing about the object, so it leaves every identifier unproven.
    return null;
  }
};

const verifyAbsentIdentifiers = async (
  identifiers: string[],
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
): Promise<Set<string>> => {
  const report = await readVerification(verifyEventsExist, identifiers);
  if (!report) {
    return new Set();
  }
  const presences: EventPresence[] = [];
  const found: RemoteEvent[] = [];
  for (const entry of report) {
    if (isEventPresence(entry)) {
      presences.push(entry);
      continue;
    }
    found.push(entry);
  }

  /* A three-valued report answers every identifier it was asked about, so whatever it did not call
     absent stays unproven. A listing of the events actually found proves absence by omission. */
  if (presences.length > 0) {
    return absencesFromPresenceReport(presences);
  }
  return absencesFromFoundEvents(identifiers, found);
};

/* The recipient really deleted the mirror, so there is nothing left for a delete to remove and its
   answer cannot tell that apart from a stale identifier. The verification read can, so on a
   destination that verifies we recreate on its word alone and never issue a speculative delete. */
const recreateVerifiedAbsentMirrors = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  calendarId: string,
  provider: CalendarSyncProvider,
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const absent = await verifyAbsentIdentifiers(replacements.map((operation) => operation.deleteId), verifyEventsExist);
  const adds: Extract<SyncOperation, { type: "add" }>[] = [];
  for (const replacement of replacements) {
    if (!absent.has(replacement.deleteId)) {
      continue;
    }
    adds.push({
      event: replacement.event,
      staleMappingId: replacement.staleMappingId,
      type: "add",
    });
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
  state: ChunkedExecutionState,
  checkpoint?: CheckpointCallback,
): Promise<boolean> => {
  const { verifyEventsExist } = provider;
  if (verifyEventsExist) {
    return recreateVerifiedAbsentMirrors(replacements, calendarId, provider, verifyEventsExist, state, checkpoint);
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

    if (present.length > 0) {
      const { runResult, unresolved: unresolvedUpdates } = await executeUpdateRun(
        present,
        updateEvents,
        provider.getRemoteEventsByIds,
        mappingsById,
        Boolean(provider.createEscapesPayloadRefusal),
      );
      unresolved = unresolvedUpdates;
      mergeRunResult(state, runResult);
      const unresolvedMappingIds = new Set(unresolved.map((operation) => operation.staleMappingId));
      for (const replacement of present) {
        if (!unresolvedMappingIds.has(replacement.staleMappingId)) {
          state.protectedRemoteUids.add(replacement.uid);
        }
      }
      state.updateFallbacks += unresolved.length;
      if (!(await checkpointRun(state, runResult.changes, checkpoint))) {
        return;
      }
    }

    if (missing.length > 0) {
      const restored = await recreateMissingMirrors(missing, calendarId, provider, state, checkpoint);
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

  const operationChunks = chunkOperations(operations, OPERATION_CHUNK_SIZE);
  const totalOperations = getTotalOperationCount(operations);
  const state: ChunkedExecutionState = {
    changes: { inserts: [], deletes: [], updates: [] },
    result: { added: 0, addFailed: 0, removed: 0, removeFailed: 0 },
    conflictsResolved: 0,
    errors: [],
    processed: 0,
    pushEcho: createPushEchoCounts(),
    superseded: false,
    checkpointRejected: false,
    protectedRemoteUids: new Set<string>(),
    updateFallbacks: 0,
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
      { ...reconciliationScope, storedFormIsObservable: canObserveStoredForm(provider) },
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

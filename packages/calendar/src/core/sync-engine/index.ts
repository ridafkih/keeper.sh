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

/* A write the destination accepted can still carry something the operator has to see - an echo the
   provider could not read is the clearest case: the object is there, and what it now looks like is
   unknown. Silence about that is its own failure, so a successful result that names an error is
   reported without being counted as a failed operation. */
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

/* Where the mapping for a created object is written down. One a read recovered is kept out of the
   returned changes and flushed on its own: the object is already on a create-only calendar, so the
   record of it may be written exactly once - losing it, or writing it twice, is a duplicate. */
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
  /* Mappings for objects the destination already holds, recovered by reading it rather than named
     by the write's own answer. They are kept apart because they may be written down exactly once. */
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

/*
 * The failure was raised while the provider was still building the request, so no bytes for this
 * object ever reached the destination. It stands exactly where learnedNothingFromDestination
 * stands: nothing was learned about the destination's copy, and repeating it learns nothing
 * again. The discriminator is the provider's own record of whether a request went out - not a
 * status allowlist, and not a provider's opinion of how trustworthy its own failure is.
 */
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

/*
 * Which failures may count towards the replacement fallback. A result carrying no answer from
 * the destination never counts, however many cycles repeat it. Everything above is excluded
 * because escalating it would risk deleting a live event for nothing. A failure for which no
 * request was ever sent counts for nothing either, however long it repeats: a serializer that
 * refuses this event refuses it identically on the create verb, so the delete such evidence would
 * license destroys the live mirror and the recreate cannot even be built. Repetition can only
 * prove something about the destination's copy once something reached the destination.
 */
const isDurableUpdateFailure = (pushResult: PushResult | undefined): boolean => {
  if (learnedNothingFromDestination(pushResult) || noRequestLeftTheProcess(pushResult)) {
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

/*
 * Which escape a promoted failure has earned. A refusal the destination itself answered came back
 * from an identifier the destination could resolve, so the verification read on that identifier
 * means something and is the only escape allowed: nothing may be deleted to break a stall. A
 * failure carrying no answer at all is ours - an unaddressable target - and the read would have to
 * trust the very identifier that failure says is unusable, so that one escapes by delete-then-add,
 * but only once the recreate is known to be buildable.
 */
const destinationAnsweredTheRefusal = (pushResult: PushResult | undefined): boolean => {
  if (pushResult?.destinationAnswer === "answered") {
    return true;
  }
  return typeof pushResult?.statusCode === "number" && pushResult.statusCode > 0;
};

/* A recreate is only possible if the create-side payload for this exact event can be produced, so
   it is produced here - by the provider, running the same serialization its create verb runs - and
   nothing is sent. */
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

/* Whether a create for this exact event could be built at all, established by the provider running
   its create verb's own serialization with nothing sent. It is not a status, not an error name and
   not a provider's opinion of its own failure: an event the create serializer refuses is an event
   no POST can carry, whatever the update verb's failure looked like. A provider that offers no
   preparation hook can establish nothing, so it keeps the routing it had. */
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

/* A promotion goes to the one escape its evidence has earned. A delete-then-add whose recreate
   cannot be built spends the customer's live mirror on nothing, so those go to the verification
   read: it destroys nothing, and it is the only thing that can still tell a mirror the recipient
   deleted from one that is standing there stale. Routing it here rather than stopping it at the
   recreate gate is the whole difference - the gate never asks the destination anything. */
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

/* The error line a failed update reports. A refusal raised before any request has no status line
   to quote, so the spread leaves it off rather than inventing one. */
const toUpdateFailureError = (
  operation: Extract<SyncOperation, { type: "replace" }>,
  pushResult: PushResult | undefined,
): OperationError => ({
  type: "update",
  error: pushResult?.error ?? describeUpdateFailure(operation, pushResult),
  ...(pushResult?.errorType && { errorType: pushResult.errorType }),
  ...(typeof pushResult?.statusCode === "number" && { statusCode: pushResult.statusCode }),
});

/* The provider recorded that the request went out, that the destination itself answered it, and the
   answer wrote nothing: the mirror stands exactly as it was, and every later cycle re-plans the
   identical replace and hears the identical refusal. That is one event nobody can act on rather
   than evidence the destination is broken, so it is graded parked - counted and named as ever, but
   unable to drive the whole calendar to the six-hour backoff ceiling where every other event on it
   would then wait for a success a quiet calendar can never reach. Nothing here is a status
   allowlist or a provider's opinion of its own failure: isDurableUpdateFailure still decides what
   the answer means, and a gone target is left out because the replacement fallback has an action
   left to take for it. */
const isAnsweredRefusalOfTheBytes = (pushResult: PushResult | undefined): boolean => {
  if (pushResult?.requestSent !== true || pushResult.destinationAnswer !== "answered") {
    return false;
  }
  if (needsReplacementFallback(pushResult)) {
    return false;
  }
  return isDurableUpdateFailure(pushResult);
};

/* The line a parked refusal leaves behind. The destination's own words say what went wrong but
   never which of the customer's events stopped moving, and no later path will mention this mapping
   again - the run report is all an operator gets - so both halves ride the same entry. */
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
  /* How many of those failures the destination answered about while writing nothing. */
  parked: number;
  conflictsResolved: number;
  errors: OperationError[];
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  refused: Extract<SyncOperation, { type: "replace" }>[];
  /* The mappings among `refused` whose update verb could not even address the object. Their escape
     is the only one a rename is open to, so the distinction has to survive the run. */
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
      /* Counted and named here, before any branch: a promotion is a request that some other path
         act, never a report that the update landed, and a receiver that stays quiet about it
         (updateRelocatedMirrors did, for both of these branches) turns the failure into a run an
         operator cannot tell from a calendar with nothing to do. */
      updateFailed += 1;
      /* Graded here, beside the counter it pays for, and on the evidence this branch already holds:
         the destination answered about the bytes and wrote nothing. Whether this cycle also
         promotes the mapping changes nothing about that - the calendar is not what is at fault
         either way - so the park rides alongside every branch below. */
      if (isAnsweredRefusalOfTheBytes(pushResult)) {
        parked += 1;
        errors.push(toParkedRefusalError(operation, pushResult));
      } else {
        errors.push(toUpdateFailureError(operation, pushResult));
      }

      /* Nothing left the process, so there is no evidence here to accumulate and there never will
         be: the counter stays exactly where it was and the mapping takes the read-first escape now.
         The read destroys nothing, and it is the only thing that can still notice a mirror the
         recipient deleted while this refusal repeats. */
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
          /* The evidence has been spent on this promotion. Leaving it standing would re-promote
             the same mapping every cycle for as long as the replacement keeps failing. */
          updates.push(toFailureCarry(failingMapping, 0));
          continue;
        }
        updates.push(toFailureCarry(failingMapping, failures));
      }
      continue;
    }

    /* The destination accepted the edit, so the mirror now carries the source's content whether
       the answer named the mapping's own uid or a re-keyed one. That is a successful operation
       even when it is not an add. */
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
  /* Mappings for objects the destination already holds that a read had to recover. They are flushed
     by commitAddRun, which writes them down exactly once. */
  recovered?: PendingChanges["inserts"];
}

interface UpdateRunResult {
  runResult: RunResult;
  unresolved: Extract<SyncOperation, { type: "replace" }>[];
  /* Promotions the destination itself answered. They are kept apart from `unresolved` because the
     only escape they may take is the verification read: a delete issued to break their stall would
     destroy a mirror the destination just proved it still holds. */
  refused: Extract<SyncOperation, { type: "replace" }>[];
  /* Stale mapping ids among `refused` whose update verb never sent a byte because it could not
     address the object at all. */
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
  /* Only the relocated path fills this: it is the uid a read just observed on the object at the
     located identifier, and nothing else in the engine has looked. */
  verifiedUidByMappingId?: Map<string, string>,
): Promise<UpdateRunResult> => {
  const updates: EventUpdate[] = replacements.map((operation) => {
    const verifiedUid = verifiedUidByMappingId?.get(operation.staleMappingId);
    /* Carried only when a read produced one: an absent key is the ordinary update, and no provider
       may read a missing uid as an identity anything vouched for. */
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
        /* Carried only when there is one, so an ordinary update run reports the shape it always did. */
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
    /* Carried only when there is one, so a run with nothing parked reports the shape it always
       reported and no caller has to learn a new key to read an ordinary result. */
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

/*
 * Records a run of creates. Ordinary inserts keep the path they always had. An insert a read
 * recovered - the identity of an object a create already put on the calendar under an answer the
 * provider could not read - is flushed through the checkpoint instead, because that is what makes
 * it durable: until it is written down, the next cycle plans the very same create and Outlook's
 * create-only POST leaves a second copy the customer can never get rid of. It travels in the
 * returned changes only when there is no checkpoint to flush it, so it is recorded exactly once
 * either way, and its uid is protected the moment it is known.
 */
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

/* An identifier the destination calendar itself never returned may not reach a delete: Outlook's
   delete verb is an unconditional mailbox-wide DELETE /me/events/{id}, so an identifier last seen in
   another folder destroys the customer's only copy. A mapping whose mirror the read located outside
   this calendar carries no identifier at all, and there is nothing in this calendar to remove.

   The mapping itself is kept rather than retired: it is what still recognises the customer's copy as
   ours if it is ever moved back, and a forgotten copy is what the next full listing sweeps away as
   an unmapped orphan. */
const namesNoDestinationEvent = (operation: Extract<SyncOperation, { type: "remove" }>): boolean =>
  operation.deleteId === NO_DESTINATION_EVENT_IDENTIFIER;

const recordUnremovableMirrors = (
  state: ChunkedExecutionState,
  unremovable: Extract<SyncOperation, { type: "remove" }>[],
): void => {
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    /* The mirror is not here to remove and no later cycle changes that, so it is reported without
       grading the destination broken. */
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

/* No delete went out and none ever will while this keeps failing, so the mirror is alive and the
   mapping still names it. Named rather than acted on, in the shape recordUnrepairableRefusal uses:
   an operator sees which mapping is frozen and why, and a later cycle retries it. */
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
    /* One event nobody can act on, and every later cycle will say the same: reported, but never
       evidence that the destination itself is broken. */
    result: { added: 0, addFailed: 1, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

/* The gate every destructive delete-then-add passes first. A provider that offers no preparation
   hook keeps today's behaviour; one that does may only delete for operations whose replacement
   really built. */
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
  /* Identifiers the read positively placed in this destination calendar, whether or not it handed
     back the object. Without the object nothing can be repaired, so these stay unsettled -- but the
     destination did say the customer's copy is at the identifier the mapping holds, which is a
     different thing from a read that said nothing about it at all. */
  confirmed: Set<string>;
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
  /* Why one particular identifier could not be settled, when that differs from what the read as a
     whole failed at. A read that answered about the wrong object failed for that mapping alone, and
     an operator reading "the read returned no verdict" would go looking for a mute destination. */
  unsettledReasons: Map<string, string>;
}

const UNSETTLED_BY_REPORT = "the verification read returned no verdict for it";

const UNSETTLED_BY_EMPTY_ANSWER = "the verification read came back saying nothing at all about it";

/* The read answered about the identifier, but the object it handed back is a different Keeper event.
   That answer proves nothing about our mirror: it is not a location to write to, and it is not an
   absence either, because some event really is standing at that identifier. */
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

/* An identifier answers for the event whose uid the mapping carries, and for no other. A read that
   hands back an object bearing a different uid has found somebody else's event standing where ours
   was expected -- an href re-keyed under a sibling, an item id that outlived its event -- and
   nothing in that answer is about our mirror. Whether the identities match is read off the object
   the destination actually returned, never off the answer's status. */
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
    /* Not located, and deliberately not confirmed either: confirmation is what licenses the delete
       the promotion path spends, and the object standing there is another customer event. */
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
    /* "elsewhere" found the mirror outside the calendar this sync owns, so it may never license a
       create. It is still a live item the read identified, and a Graph item id addresses the item
       mailbox-wide, so it is kept in its own bucket: repairable, never creatable. */
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
const settledIdentifiersFromPresenceReport = (
  report: EventPresence[],
  askedUids: Map<string, string>,
): Set<string> => {
  const settled = new Set<string>();
  for (const presence of report) {
    if (presence.status === "unknown") {
      continue;
    }
    // An answer about another event decides nothing about ours, however definite it sounded.
    if (answersAboutADifferentEvent(presence, askedUids)) {
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
  /* Identifiers the run's own destination listing already failed to enumerate. They are the only
     ones an answer that says nothing can leave absent. */
  corroboratedAbsent: ReadonlySet<string>,
): Promise<MirrorVerdicts> => {
  const identifiers = targets.map((target) => target.deleteId);
  /* The uid each identifier was asked about, so an answer can be checked against the question. */
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
  /* An answer with nothing in it carries no shape: it is a listing that found no object, and it is
     equally a per-identifier report whose verdict for this target went missing. Absence by omission
     needs a listing to be omitted from, so it is granted only where the run has an observation of
     its own to stand on -- the destination listing that planned this cycle did not enumerate the
     mirror either. A promotion holds no such observation: its whole evidence is one verb's answer
     about one target, so an empty read leaves it unsettled and everything standing. */
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

  /* A three-valued report answers every identifier it was asked about, so whatever it did not call
     absent stays unproven. A listing of the events actually found proves absence by omission. */
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

/* The plan called this mirror missing, and the read answered with the object itself: under a new id
   because the destination re-keyed it, under the same id because the listing that planned the run
   simply did not see it, or in another folder the customer dragged it into. Every one of those is a
   live object, so the ending is the same -- update it in place by the id the read actually saw.
   Nothing else in the run carries this observation: without it the mapping keeps naming whatever it
   held, the pending edit never lands, and the identical dead plan is recomputed every cycle. */

/* Where the read saw it is the whole difference between an identifier that may be written down and
   one that may not: inDestination was returned by the calendar this sync owns, so it is the delete
   identifier; outside was found in another folder of the mailbox, so it is a handle for this run's
   update and nothing more. */
interface SurvivingMirror {
  event: RemoteEvent;
  inDestination: boolean;
}

/* The object the read handed back is this mapping's mirror only if it carries this mapping's uid.
   Anything else is another customer event standing at the identifier, and treating it as the
   surviving mirror writes our event's body over theirs and then teaches the mapping their uid. */
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

/* The mirror is alive in another folder, so the id it wears there is the only handle this run has on
   the customer's copy -- and it may never be written down. mapping.deleteIdentifier IS the delete
   identifier: the remove path builds its operation straight from it, with no presence check and no
   calendar scoping, and Outlook deletes mailbox-wide. So the mapping learns the thing the read
   actually proved instead: this destination calendar holds no event for it. */
const toOutsideDestinationRepair = (mapping: EventMapping): PendingUpdate => ({
  deleteIdentifier: NO_DESTINATION_EVENT_IDENTIFIER,
  destinationEventUid: mapping.destinationEventUid,
  endTime: mapping.endTime,
  id: mapping.id,
  startTime: mapping.startTime,
  syncEventHash: mapping.syncEventHash,
  syncEventId: mapping.syncEventId,
});

/* The edit still reaches the customer's copy this run, but the calendar this sync owns holds no
   mirror for the mapping at all: what the read found is outside it, that identifier may never be
   written down, and nothing here can put a mirror back without duplicating the copy the customer
   already has. The mapping is going to stay wrong, so it is named rather than passed off as a
   healthy update. */
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
    /* One event nobody can act on, and every later cycle will say the same: reported, but never
       evidence that the destination itself is broken. */
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
    result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0 },
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

/* The push echoes the id of the copy it just wrote to, and for a mirror found outside this calendar
   that echo is an out-of-destination identifier. Letting it land on the mapping is exactly the write
   the remove path would later delete by, so the delivery records what the repair records: the
   accepted content hash, the uid the mapping already held, and no destination identifier at all. */
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
    error: `the update for mapping ${replacement.staleMappingId} keeps failing and its mirror stands: ${reason}`,
  });
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    /* One event nobody can act on, and every later cycle will say the same: reported, but never
       evidence that the destination itself is broken. */
    result: { added: 0, addFailed: 1, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

/* The write to the identifier the read located answered that it is gone, so the read's own verdict
   is already stale: the object was re-keyed again, or the recipient deleted it between the two
   calls. Nothing here may act on that -- a create needs proof of absence this run does not have,
   and a delete-then-add would buy a speculative DELETE against a mirror the read just called alive
   -- so the mapping keeps the identifier it arrived with and the stuck mapping is named. */
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

/* A promotion the relocated path handles in this same run has not spent its evidence: the mapping
   is still refusing, and zeroing the counter here is what made it rebuild the identical case and
   throw it away again, cycle after cycle, forever. */
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

/* Deliver the pending edit to the id the read located, in this run: the mapping repair alone would
   leave the mirror a cycle behind the source, and a delete-then-add would duplicate it permanently
   on a create-only provider. Whatever the update run could not settle is routed from here: nobody
   else receives these promotions, and a promotion nobody receives is a failure nobody reports. */
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
  /* The identifier the read located is exactly the one that just answered 404, and the hash beside
     it is the pre-edit one, so writing it down would tell the next cycle a mirror that never
     received the edit is settled. */
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

  /* This run already holds the read the refusal escape would go and ask for: the mirror was
     located, addressed, and refused again on the identity the read handed back. Asking a second
     time could only answer the same thing, so the stall is named here - counted, attributed to its
     mapping, and never bought out of with a delete. */
  for (const replacement of refused) {
    recordUnrepairableRefusal(
      state,
      replacement,
      `the destination keeps refusing the update to the mirror it located at ${replacement.deleteId}, so the stale copy stands`,
    );
  }
  return true;
};

/* One mirror the read could not settle, and what it nonetheless said. "Present" with no object
   repairs nothing, so it settles nothing -- but the destination did place the customer's copy at the
   identifier the mapping already holds, and that is not the same evidence as a read which never
   answered. The two get different endings, so they are carried apart. */
interface UnsettledMirror {
  confirmedAtIdentifier: boolean;
  replacement: Extract<SyncOperation, { type: "replace" }>;
}

/* A mirror the read could not settle is a restore that did not happen, and the counters alone say
   exactly what a healthy run says. Counting it and naming its mapping is the only thing that lets
   an operator tell a customer's mirror that is never coming back from a calendar with nothing to do.
   Naming does not license acting: unsettled still means no create and no delete. */
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

/* The read handed back the object under the same key and uid the refused update already used, so
   redelivering it would only buy the identical refusal one more time. */
const isTheSameMirror = (
  located: RemoteEvent,
  replacement: Extract<SyncOperation, { type: "replace" }>,
): boolean => located.deleteId === replacement.deleteId && located.uid === replacement.uid;

/* Whether the uid the read handed back can actually address the object our update verb could not
   name. Three things have to hold, and each one on its own is a reason the customer's copy is left
   exactly where it is:
   - the update never reached the destination because it could not address the object at all. A
     destination that answered refused the BYTES, and a retry sends those same bytes again;
   - the read handed back this mapping's own uid. It is the only thing the retry can steer by: the
     write is told to accept the href the read answered about because the uid on it is ours. A read
     that returned no uid, or a different one, addresses nothing;
   - the mapping still names the source event this edit is for. A mapping the plan has re-paired to
     a different event carries the OTHER event's uid, so the uid the read confirmed is not the one
     the write will send and the retry could not address the object either. */
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
  /* The mappings whose update verb could not address the object at all. Nothing else may be retried
     in place: a destination that answered about the object refused the bytes, and a retry sends the
     same bytes to the same object. */
  unaddressableMappingIds: ReadonlySet<string> = new Set(),
  /* Filled with the replacements the read could not settle. The caller that owns the escape is the
     only place that can decide what a read which never answers is allowed to license, and it needs
     to know which mappings those were. */
  unsettledSink?: UnsettledMirror[],
): Promise<boolean> => {
  /* The replace already carries the uid the mapping holds; dropping it here is what left Outlook
     unable to ever say absent, so a mirror the recipient deleted was never restored. */
  const targets = replacements.map((operation) => ({
    deleteId: operation.deleteId,
    uid: operation.uid,
  }));
  /* The plan calls a replacement remoteMissing when the destination listing this cycle read did not
     hold the mirror either, which is the second observation an omission needs to mean absence. */
  const listingMissed = new Set(
    replacements
      .filter((operation) => operation.remoteMissing === true)
      .map((operation) => operation.deleteId),
  );
  const verdicts = await verifyMirrors(targets, verifyEventsExist, listingMissed);
  /* Named unconditionally: optional chaining on the sink would skip the call that counts and
     reports them whenever no caller asked for the list. */
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
        /* The read proved the object present and ours at a href our update verb cannot name, so the
           repair is the write itself, retried in place carrying the uid the read verified: one PUT
           to the very href the read answered about. A create here would put a second object bearing
           this live uid in the same collection - refused by a compliant server, a permanent
           duplicate on a lenient one - so no create and no delete may go out on this path. */
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
  /* Filled with the replacements the read could not settle, so the caller can park them. A restore
     that did not happen because the destination said nothing usable reads exactly like a run with
     nothing to do unless it is graded. */
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

  /* This branch deletes in order to recreate too, so it earns the delete the same way. */
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

/* Unsettled reads count on their own persisted field. The answered-refusal counter says the
   destination keeps rejecting this update; this one says the destination will not say anything at
   all. Sharing one number let each top the other up, so an event was destroyed on the strength of
   two ordinary refusals plus a single read that answered nothing. This cycle may already have
   written the tally for the mapping, so the last write wins over the arrival value. */
const countUnsettledRead = (state: ChunkedExecutionState, mapping: EventMapping): number => {
  const carried = (state.changes.updates ?? [])
    .findLast((update) => update.id === mapping.id);
  if (typeof carried?.consecutiveUnsettledReads === "number") {
    return carried.consecutiveUnsettledReads + 1;
  }
  return (mapping.consecutiveUnsettledReads ?? 0) + 1;
};

/* A promotion zeroes the answered-refusal counter because the escape it hands the mapping to is
   expected to settle it. An unsettled read settles nothing, so that evidence was not spent: left
   at zero the mapping re-earns the same three refusals before it asks again, and the read that
   might finally answer is only taken every third cycle. Restored only when this run is what
   zeroed it, so a refusal that never reached the destination cannot manufacture evidence here. */
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

/* Carries the mapping forward with the unsettled tally advanced and nothing else touched: a read
   that said nothing learned nothing about the mirror's identity, content or times. */
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

/* One mapping the destination will not talk about. recordUnsettledMirrors has already named it and
   counted it against the run's unsettled reads, and the update run that sent it here already
   counted its failure, so all that is added is the grading: parked, and therefore not an
   actionable failure. Graded failed, one mute mapping pins the whole calendar at the six-hour
   backoff ceiling where every other event on it then waits. */
const recordUnsettledPark = (state: ChunkedExecutionState): void => {
  mergeRunResult(state, {
    changes: { inserts: [], deletes: [] },
    result: { added: 0, addFailed: 0, updated: 0, removed: 0, removeFailed: 0, parked: 1 },
    conflictsResolved: 0,
    errors: [],
  }, false);
};

/* Park every mapping whose read could not settle. Parking is the state while the destination stays
   mute, not the resting place of the event: the tally advances, the mapping keeps its identifier,
   and the next cycle asks again -- so the cycle the read finally answers absent the mirror is
   recreated, and the cycle it answers present-elsewhere it is relocated, through the ordinary
   branches of resolveVerifiedMirrors. Nothing here promotes to a delete: a read that says nothing
   is not evidence about the object, and no number of repetitions of nothing becomes evidence. */
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

/* The escape for a refusal the destination answered on the same mapping cycle after cycle. It may
   only ever end in a recreate of a mirror the read proved absent, a relocation of one it found
   elsewhere, or a named park: a delete would destroy the customer's only copy to make a stall stop
   repeating, which is the trade this whole path exists to refuse. A destination that cannot verify,
   or one whose read keeps saying nothing, has no proof to offer either way, so its mappings are
   named and parked rather than acted on -- and asked again on every later cycle. */
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

/* The escape an unaddressable failure earns, on a destination that can answer questions about its
   own objects. The delete it used to spend went out on an identifier nothing had looked at, so the
   read runs first - through the same route escapeRefusedUpdates takes, which already settles absent,
   surviving and relocated mirrors without removing anything. Only what the read could not settle
   keeps the escape it had, and a destination with no read at all keeps its behaviour untouched. */
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

  /* A read that proved the identifier absent has already answered the only question the delete
     could have asked, and it answered that there is nothing there: so the replacement is created on
     the read's word and no delete goes out. Spending one anyway would at best be wasted and at
     worst reach an object nobody verified. Only what the read could not settle keeps the escape it
     had; resolveVerifiedMirrors creates what the read proved absent. */
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

  /* A read that never answered leaves the escape nowhere to go. A delete-then-add on an identifier
     nothing looked at is the whole hazard this path exists to refuse: the DELETE removes a live copy
     no read has seen, and the POST behind it is a create with no idempotency key. Parking keeps the
     mapping and its identifier exactly as they are, and asks the destination again next cycle. */
  const unanswered = unsettled.filter((mirror) => !mirror.confirmedAtIdentifier);
  const carries = parkUnsettledMirrors(
    state,
    unanswered.map((mirror) => mirror.replacement),
    mappingsById,
  );
  if (!(await checkpointRun(state, { inserts: [], deletes: [], updates: carries }, checkpoint))) {
    return false;
  }

  /* The read did answer for these: the customer's copy is in this calendar at the identifier the
     mapping holds. It handed back no object, so nothing can be repaired in place -- but the delete
     this escape spends is aimed at an object the destination itself just placed there. */
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
      /* Parking is the same ending the other verified paths give an unsettled read: the tally
         advances, the mapping keeps its identifier, and the next cycle asks again -- nothing is
         created, deleted or written on an answer that proved nothing. */
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

const readOperationMappingId = (operation: SyncOperation): string | null => {
  if (operation.type === "remove") {
    return operation.mappingId ?? null;
  }
  return operation.staleMappingId ?? null;
};

/* A mapping the destination calendar holds no event for produces no operation at all: there is
   nothing here to update, a create would duplicate the copy the customer already has on a
   create-only push, and the identifier the copy wears outside this calendar may never reach a
   delete. Doing nothing is the only safe ending -- and doing nothing quietly, cycle after cycle, is
   how a mirror stays permanently wrong without anyone knowing, so every such mapping is named. */
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
    /* Parked, not failed: the copy is outside this calendar and every future cycle will say so
       again, so it is reported without grading the destination broken. */
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

  /* The repaired identifier only helps the customer once it is written down: without this flush the
     mapping keeps naming the dead id and the same destructive plan is recomputed every cycle. */
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

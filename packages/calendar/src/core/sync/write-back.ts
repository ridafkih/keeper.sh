import type { EventMapping } from "../events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../types";
import {
  createSyncEventContentHash,
  normalizeText,
} from "../events/content-hash";
import { resolveIsAllDayEvent } from "../events/all-day";
import { DEFAULT_EVENT_NAME } from "../events/default-event-name";
import {
  TWO_WAY_DELETE_ABSOLUTE_CEILING,
  TWO_WAY_EDIT_ABSOLUTE_CEILING,
  TWO_WAY_EDIT_ABSOLUTE_FLOOR,
  TWO_WAY_WRITE_BACK_DAILY_CAP,
  TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS,
} from "@keeper.sh/constants";
import type { PendingUpdate } from "../sync-engine/types";
import {
  isInsideSourceAuthoritativeWindow,
  isSameSerializedSecond,
  matchRemoteEventsToMappings,
} from "./operations";
import type { ReconciliationScope } from "./operations";
import {
  assertWriteBackPayload,
  resolveWriteBackEligibleFields,
} from "./write-back-policy";
import type {
  WriteBackField,
  WriteBackPolicy,
  WriteBackUpdates,
} from "./write-back-policy";

const MINUTE_MS = 60_000;
const EMPTY_LINE_LENGTH = 0;
const TWO_WAY_DELETE_GRACE_MS = 10 * MINUTE_MS;
const TWO_WAY_DELETE_MIN_OBSERVATIONS = 2;
const TWO_WAY_DELETE_ABSOLUTE_FLOOR = 5;
const TWO_WAY_DELETE_RATIO = 0.2;
const TWO_WAY_EDIT_RATIO = 0.5;
const TWO_WAY_EPOCH_QUARANTINE_LIMIT = 5;
const TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT = 30;
const TWO_WAY_EPOCH_WINDOW_MS = 60 * MINUTE_MS;
const FIRST_OBSERVATION = 1;
const NO_OBSERVATIONS = 0;
const NO_EPOCHS = 0;

type ReadHealth = "ambiguous_empty" | "healthy" | "live_empty";

type WriteBackRejectionReason =
  | "availability_clamped"
  | "availability_not_writable"
  | "bulk_edit_breaker"
  | "never_observed"
  | "recurring_event"
  | "redacted_field"
  | "write_back_quarantined";

interface DestinationDrift {
  availability: boolean;
  content: boolean;
  time: boolean;
}

interface ObservedDestinationState {
  availability: EventAvailability | null;
  contentHash: string;
  description: string;
  endTime: Date;
  isAllDay: boolean;
  location: string;
  startTime: Date;
  summary: string;
}

interface ExpectedSourceFields {
  description?: string;
  endTime?: Date;
  isAllDay?: boolean;
  location?: string;
  startTime?: Date;
  summary?: string;
}

type InboundClassification =
  | {
    mappingId: string;
    mappingUpdate?: PendingUpdate;
    missingObservationCount: number;
    type: "none";
  }
  | {
    mappingId: string;
    mappingUpdate: PendingUpdate;
    observed: ObservedDestinationState;
    type: "adopt-baseline";
  }
  | {
    expectedSource: ExpectedSourceFields;
    expectedSyncEventHash: string | null;
    mappingId: string;
    mappingUpdate?: PendingUpdate;
    observed: ObservedDestinationState;
    /*
     * Null leaves the recorded push hash alone so the outbound comparison stays armed:
     * the source is carrying a change on an axis this payload does not write, and only a
     * push can carry that axis to the copy.
     */
    projectedSyncEventHash: string | null;
    sourceEventUid: string;
    type: "write-back";
    updates: WriteBackUpdates;
  }
  | {
    mappingId: string;
    mappingUpdate?: PendingUpdate;
    resolution: "source-wins";
    type: "conflict";
  }
  | {
    mappingId: string;
    mappingUpdate?: PendingUpdate;
    observed?: ObservedDestinationState;
    reason: WriteBackRejectionReason;
    type: "rejected";
  }
  | {
    mappingId: string;
    mappingUpdate: PendingUpdate;
    missingFirstObservedAt: Date;
    missingObservationCount: number;
    type: "delete-candidate";
  }
  | {
    expectedSource: ExpectedSourceFields;
    expectedSyncEventHash: string | null;
    mappingId: string;
    sourceEventUid: string;
    type: "delete";
  };

interface InboundCounters {
  adoptWindowDivergence: number;
  ambiguousEmptyRead: number;
  blockedAvailability: number;
  blockedRedactedField: number;
  conflictSourceWins: number;
  deleteBreakerTripped: number;
  editBreakerTripped: number;
}

interface DeleteConfirmationRequest {
  reason: "all_copies_missing" | "delete_breaker_tripped";
  sourceCalendarIds: string[];
}

/*
 * A held edit has no answer a user could give that would make it safe to apply: the
 * previous values of the real events are already gone from everywhere but the source
 * itself, so there is nothing to confirm and nothing to restore. The pair stops writing
 * and says why, and the copies go back to matching the source.
 */
interface WriteBackHoldRequest {
  reason: "bulk_edit_breaker";
  sourceCalendarIds: string[];
}

interface InboundClassificationResult {
  classifications: InboundClassification[];
  counters: InboundCounters;
  deleteBreakerTripped: boolean;
  deleteConfirmation: DeleteConfirmationRequest | null;
  /*
   * The source calendars a read that came back with copies covered. "Delete the originals"
   * is only ever asked after a read that returned nothing at all, and that read cannot
   * tell an emptied destination from a broken connection, so the answer is withheld until
   * a read has returned something since. The classifier is the only place that fact
   * exists, and it does not survive the pass, so it is reported here to be recorded.
   */
  healthyReadSourceCalendarIds: string[];
  readHealth: ReadHealth;
  suppressedMappingIds: string[];
  writeBackHold: WriteBackHoldRequest | null;
}

interface ClassifyInboundChangesInput {
  existingMappings: EventMapping[];
  localEvents: MaterializedSyncableEvent[];
  now: Date;
  /*
   * The destination provider's own reshaping of a source event, exactly as the push path
   * applied it. Every mapping hash and time was recorded from the result, so the caller
   * has to hand the same reshaping here or the comparisons are made against a reading of
   * the event the destination was never given.
   */
  projectLocalEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  remoteEvents: RemoteEvent[];
  remoteRawItemCount: number;
  scope: ReconciliationScope;
}

/*
 * The witness adopts and clears as one unit. A row carrying a hash without the field
 * values it was taken from predates the per-field witness, so it reads as unverified and
 * the next observation records it rather than acting on it.
 */
const isWitnessRecorded = (mapping: EventMapping): boolean =>
  typeof mapping.destinationContentHash === "string"
  && typeof mapping.destinationSummary === "string"
  && typeof mapping.destinationDescription === "string"
  && typeof mapping.destinationLocation === "string"
  && typeof mapping.destinationIsAllDay === "boolean"
  && mapping.destinationStartTime instanceof Date
  && mapping.destinationEndTime instanceof Date;

const getDestinationDrift = (
  mapping: EventMapping,
  remoteEvent: RemoteEvent,
): DestinationDrift => {
  const recordedContentHash = mapping.destinationContentHash;
  if (!isWitnessRecorded(mapping)) {
    return { availability: false, content: false, time: false };
  }

  const content = typeof remoteEvent.editableContentHash === "string"
    && remoteEvent.editableContentHash !== recordedContentHash;
  const availability = typeof mapping.destinationAvailability === "string"
    && typeof remoteEvent.editableAvailability === "string"
    && remoteEvent.editableAvailability !== mapping.destinationAvailability;
  const recordedStartTime = mapping.destinationStartTime;
  const recordedEndTime = mapping.destinationEndTime;
  const time = recordedStartTime instanceof Date
    && recordedEndTime instanceof Date
    && (!isSameSerializedSecond(remoteEvent.startTime, recordedStartTime)
      || !isSameSerializedSecond(remoteEvent.endTime, recordedEndTime));

  return { availability, content, time };
};

const resolveReadHealth = (
  remoteEventCount: number,
  rawItemCount: number,
  mappingCount: number,
): ReadHealth => {
  if (remoteEventCount > NO_OBSERVATIONS) {
    return "healthy";
  }
  if (rawItemCount > NO_OBSERVATIONS) {
    return "live_empty";
  }
  if (mappingCount > NO_OBSERVATIONS) {
    return "ambiguous_empty";
  }
  return "healthy";
};

const createCounters = (): InboundCounters => ({
  adoptWindowDivergence: 0,
  ambiguousEmptyRead: 0,
  blockedAvailability: 0,
  blockedRedactedField: 0,
  conflictSourceWins: 0,
  deleteBreakerTripped: 0,
  editBreakerTripped: 0,
});

const isRecurringMapping = (mapping: EventMapping): boolean =>
  mapping.syncEventId !== mapping.eventStateId
  || typeof mapping.recurrenceRule === "string"
  || mapping.recurrenceId instanceof Date;

/*
 * One column counts two different things. A spend that reached a real calendar is what the
 * runaway stop exists for, and five in a window is the most any mapping may ever land. A
 * spend the provider rejected reached nothing: a throttle rejects for as long as it
 * throttles, and the applier goes on retrying one for a budget far longer than five.
 * Judging a rejected spend by the landed limit stops the classifier handing the applier the
 * work while the applier is still waiting to escalate — leaving the event written back to
 * nowhere, repaired from nowhere, and the pair reporting healthy, for good. So a budget
 * spent on rejections alone is judged by the applier's failure limit. Only a rejection moves
 * the window without stamping a landed write, so a stamp no older than the window means the
 * spend landed and five stands — including the write that opened the window itself, which
 * stamps both at once.
 */
const resolveEpochLimit = (mapping: EventMapping): number => {
  const appliedAt = mapping.writeBackLastAppliedAt;
  if (!(appliedAt instanceof Date)) {
    return TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT;
  }
  const windowStart = mapping.writeBackEpochWindowStart;
  if (windowStart instanceof Date && appliedAt.getTime() < windowStart.getTime()) {
    return TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT;
  }
  return TWO_WAY_EPOCH_QUARANTINE_LIMIT;
};

/*
 * The window rolls, so a mapping that wrote back a few times an hour ago starts again from
 * zero. A mapping that reached the limit does not: a breach is sticky until a human clears
 * it, because otherwise a destination that varies on every read would be handed a fresh
 * budget every hour forever.
 */
const resolveEffectiveEpoch = (mapping: EventMapping, now: Date): number => {
  const epoch = mapping.writeBackEpoch ?? NO_EPOCHS;
  if (epoch >= resolveEpochLimit(mapping)) {
    return epoch;
  }
  const windowStart = mapping.writeBackEpochWindowStart;
  if (windowStart instanceof Date && now.getTime() - windowStart.getTime() >= TWO_WAY_EPOCH_WINDOW_MS) {
    return NO_EPOCHS;
  }
  return epoch;
};

/*
 * The window is read before the count, exactly as the counter's own SQL assignment does. A
 * spent budget whose window has since elapsed is a fresh budget, and returning the stale
 * count instead would make the cap a permanent, silent kill switch for that one event.
 */
const resolveEffectiveDailyCount = (mapping: EventMapping, now: Date): number => {
  const windowStart = mapping.writeBackDailyWindowStart;
  if (
    windowStart instanceof Date
    && now.getTime() - windowStart.getTime() >= TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS
  ) {
    return NO_EPOCHS;
  }
  return mapping.writeBackDailyCount ?? NO_EPOCHS;
};

const isBudgetSpent = (mapping: EventMapping, now: Date): boolean =>
  resolveEffectiveEpoch(mapping, now) >= resolveEpochLimit(mapping)
  || resolveEffectiveDailyCount(mapping, now) >= TWO_WAY_WRITE_BACK_DAILY_CAP;

const createWitnessUpdate = (
  mappingId: string,
  observed: ObservedDestinationState,
): PendingUpdate => ({
  destinationAvailability: observed.availability,
  destinationContentHash: observed.contentHash,
  destinationDescription: observed.description,
  destinationEndTime: observed.endTime,
  destinationIsAllDay: observed.isAllDay,
  destinationLocation: observed.location,
  destinationStartTime: observed.startTime,
  destinationSummary: observed.summary,
  id: mappingId,
  missingFirstObservedAt: null,
  missingObservationCount: NO_OBSERVATIONS,
});

const hasPendingDeleteState = (mapping: EventMapping): boolean =>
  (mapping.missingObservationCount ?? NO_OBSERVATIONS) > NO_OBSERVATIONS
  || mapping.missingFirstObservedAt instanceof Date;

const resolveAvailabilityRejection = (
  localEvent: MaterializedSyncableEvent,
  remoteEvent: RemoteEvent,
): WriteBackRejectionReason => {
  const localAvailability = localEvent.availability ?? "busy";
  const supported = remoteEvent.supportedAvailabilities ?? [];
  if (supported.includes(localAvailability)) {
    return "availability_not_writable";
  }
  return "availability_clamped";
};

interface ContentUpdates {
  allDayChanged: boolean;
  observedIsAllDay: boolean;
  rejected: boolean;
  rejectedFields: WriteBackField[];
  text: WriteBackUpdates;
}

const resolveLocalIsAllDay = (localEvent: MaterializedSyncableEvent): boolean =>
  resolveIsAllDayEvent({
    endTime: localEvent.endTime,
    isAllDay: localEvent.isAllDay,
    startTime: localEvent.startTime,
  });

/*
 * A destination that stores rich text and hands back a plain-text rendering of it pads
 * line ends and inserts blank lines. Attribution absorbs that rendering: the cost is
 * that a whitespace-only edit is not written back, and the gain is that the
 * destination's own re-encoding never overwrites the real value on the source.
 */
const normalizeRenderedText = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > EMPTY_LINE_LENGTH)
    .join("\n");

const hasFieldMoved = (observed: string, recorded: string | null | undefined): boolean =>
  normalizeRenderedText(observed) !== normalizeRenderedText(recorded ?? "");

const collectContentUpdates = (
  mapping: EventMapping,
  observed: ObservedDestinationState,
  eligibleFields: ReadonlySet<WriteBackField>,
): ContentUpdates => {
  const recorded: [WriteBackField, string, string | null | undefined][] = [
    ["summary", observed.summary, mapping.destinationSummary],
    ["description", observed.description, mapping.destinationDescription],
    ["location", observed.location, mapping.destinationLocation],
  ];

  const textChanges = recorded
    .filter(([, value, baseline]) => hasFieldMoved(value, baseline))
    .map(([field, value]): [WriteBackField, string] => [field, value]);
  const writable = textChanges.filter(([field]) => eligibleFields.has(field));

  return {
    allDayChanged: observed.isAllDay !== mapping.destinationIsAllDay,
    observedIsAllDay: observed.isAllDay,
    rejected: writable.length !== textChanges.length,
    rejectedFields: textChanges
      .filter(([field]) => !eligibleFields.has(field))
      .map(([field]) => field),
    text: Object.fromEntries(writable),
  };
};

const collectExpectedSource = (
  localEvent: MaterializedSyncableEvent,
  updates: WriteBackUpdates,
): ExpectedSourceFields => ({
  ...("summary" in updates && { summary: localEvent.summary }),
  ...("description" in updates && { description: localEvent.description ?? "" }),
  ...("location" in updates && { location: localEvent.location ?? "" }),
  ...("startTime" in updates && { startTime: localEvent.startTime }),
  ...("endTime" in updates && { endTime: localEvent.endTime }),
  ...("isAllDay" in updates && { isAllDay: resolveLocalIsAllDay(localEvent) }),
});

/*
 * A deletion is refused outright when any field of the source moved since the last push, so
 * the evidence it carries has to cover every one of those fields. Reporting the schedule
 * alone would let a title or a note edited between the classification and the lock go
 * unnoticed, and the event would be destroyed on the strength of a stale reading.
 *
 * The text has to be the source's own, never the projection pushed to the destination: on
 * a calendar that hides names, descriptions or locations — the default for all three — the
 * projection is a calendar-name template and two empty strings, which the source row can
 * never match. Comparing against that would refuse every deletion forever. An event that
 * arrives without its source row attached carries no text evidence at all, and the applier
 * refuses a deletion whose evidence is incomplete rather than guessing at it.
 */
const collectExpectedSourceForDelete = (
  localEvent: MaterializedSyncableEvent,
): ExpectedSourceFields => {
  const { sourceFields } = localEvent;
  return {
    endTime: localEvent.endTime,
    isAllDay: resolveLocalIsAllDay(localEvent),
    startTime: localEvent.startTime,
    ...(sourceFields && {
      description: sourceFields.description ?? "",
      location: sourceFields.location ?? "",
      summary: sourceFields.title ?? DEFAULT_EVENT_NAME,
    }),
  };
};

interface PendingDelete {
  deleteApproved: boolean;
  localEvent: MaterializedSyncableEvent;
  mapping: EventMapping;
  missingFirstObservedAt: Date;
  missingObservationCount: number;
}

const createDeleteCandidate = (pending: PendingDelete): InboundClassification => ({
  mappingId: pending.mapping.id,
  mappingUpdate: {
    id: pending.mapping.id,
    missingFirstObservedAt: pending.missingFirstObservedAt,
    missingObservationCount: pending.missingObservationCount,
  },
  missingFirstObservedAt: pending.missingFirstObservedAt,
  missingObservationCount: pending.missingObservationCount,
  type: "delete-candidate",
});

interface MappingOutcome {
  classification?: InboundClassification;
  pendingDelete?: PendingDelete;
  suppress: boolean;
}

/*
 * Two readings of the same event, and they are not interchangeable. `localEvent` is the
 * row as Keeper.sh holds it, and it is the only thing a write to the source may be built
 * from or judged against. `projectedEvent` is what the destination provider was actually
 * handed — the same row after that provider's own reshaping — and every comparison against
 * the mapping or against the copy has to use it, because the mapping's hash and times were
 * recorded from it. Judging the copy against the raw row instead makes the pair report a
 * source edit on every pass for any event the destination reshapes, which silently turns
 * two-way sync off for that event and hands the copy back to the rebuild path.
 */
interface MappingContext {
  counters: InboundCounters;
  localEvent: MaterializedSyncableEvent;
  mapping: EventMapping;
  now: Date;
  policy: WriteBackPolicy;
  projectedEvent: MaterializedSyncableEvent;
  scope: ReconciliationScope;
}

const resolveEligibleMappings = (
  existingMappings: EventMapping[],
  policies: ReadonlyMap<string, WriteBackPolicy>,
  scope: ReconciliationScope,
): { mapping: EventMapping; policy: WriteBackPolicy }[] => {
  const eligible: { mapping: EventMapping; policy: WriteBackPolicy }[] = [];
  for (const mapping of existingMappings) {
    const { sourceCalendarId } = mapping;
    if (!sourceCalendarId) {
      continue;
    }
    const policy = policies.get(sourceCalendarId);
    if (!policy || policy.writeBackMode === "off") {
      continue;
    }
    if (!isInsideSourceAuthoritativeWindow(mapping, sourceCalendarId, scope)) {
      continue;
    }
    eligible.push({ mapping, policy });
  }
  return eligible;
};

const createBreakerConfirmation = (
  trippedSourceCalendarIds: ReadonlySet<string>,
): DeleteConfirmationRequest | null => {
  if (trippedSourceCalendarIds.size === NO_OBSERVATIONS) {
    return null;
  }
  return {
    reason: "delete_breaker_tripped",
    sourceCalendarIds: [...trippedSourceCalendarIds],
  };
};

const createWriteBackHold = (
  trippedSourceCalendarIds: ReadonlySet<string>,
): WriteBackHoldRequest | null => {
  if (trippedSourceCalendarIds.size === NO_OBSERVATIONS) {
    return null;
  }
  return {
    reason: "bulk_edit_breaker",
    sourceCalendarIds: [...trippedSourceCalendarIds],
  };
};

/*
 * Holding withholds the mirror as well as the deletion, so it is spent only where a
 * deletion is actually on the table: a pair that can never delete a source event has
 * nothing to protect and would be left with an empty destination it can never refill. An
 * answer is given for one source calendar, so it unlocks that calendar and no other —
 * reading it as a destination-wide clearance would let a "yes, I deleted those" for one
 * pair destroy originals on a sibling pair the user was never asked about. A mapping
 * whose copy Keeper has never observed alive is in the same position as the answer that
 * put it back: its absence predates any consent, so it belongs to the re-create path and
 * asking about it again would never end.
 *
 * An answer speaks for the disappearances it was shown and for no later one. A copy that
 * was still there when the human answered and is absent now went missing under a read
 * that returned nothing at all — the case the hold exists for — so it is asked about
 * again rather than deleted on the strength of an answer to a different question.
 */
const isApprovedFirstObservation = (
  firstObservedAt: Date | null | undefined,
  policy: WriteBackPolicy,
): boolean => {
  const approvedAt = policy.deleteApprovedAt;
  return policy.deleteApproved
    && approvedAt instanceof Date
    && firstObservedAt instanceof Date
    && firstObservedAt.getTime() <= approvedAt.getTime();
};

const isApprovedDisappearance = (
  mapping: EventMapping,
  policy: WriteBackPolicy,
): boolean => isApprovedFirstObservation(mapping.missingFirstObservedAt, policy);

const couldDeleteSourceEvents = (
  { mapping, policy }: { mapping: EventMapping; policy: WriteBackPolicy },
): boolean =>
  policy.writeBackMode === "edits_and_deletes"
  && !isApprovedDisappearance(mapping, policy)
  && isWitnessRecorded(mapping);

/*
 * Only a read that came back with at least one copy says anything: it proves the
 * credential still works AND that the calendar id still points at the calendar the copies
 * were in, which reconnecting on its own does not. A listing that carried items but none
 * of ours is a live calendar emptied of copies — not the ambiguous case, but no evidence
 * the copies are readable either, so it clears nothing.
 */
const resolveHealthyReadSourceCalendarIds = (
  readHealth: ReadHealth,
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[],
): string[] => {
  if (readHealth !== "healthy") {
    return [];
  }
  return [...new Set(eligible.flatMap(({ mapping }) => mapping.sourceCalendarId ?? []))];
};

const resolveHeldSourceCalendarIds = (
  readHealth: ReadHealth,
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[],
): Set<string> => {
  if (readHealth !== "ambiguous_empty") {
    return new Set<string>();
  }
  return new Set(
    eligible
      .filter((entry) => couldDeleteSourceEvents(entry))
      .flatMap(({ mapping }) => mapping.sourceCalendarId ?? []),
  );
};

const collectDeletingSourceCalendarIds = (
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[],
  restrictedTo: ReadonlySet<string>,
): string[] => [...new Set(
  eligible
    .filter(({ policy }) => policy.writeBackMode === "edits_and_deletes")
    .flatMap(({ mapping }) => mapping.sourceCalendarId ?? [])
    .filter((sourceCalendarId) => restrictedTo.has(sourceCalendarId)),
)];

const countBySourceCalendar = (
  entries: { mapping: EventMapping }[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { mapping } of entries) {
    const { sourceCalendarId } = mapping;
    if (!sourceCalendarId) {
      continue;
    }
    counts.set(sourceCalendarId, (counts.get(sourceCalendarId) ?? NO_OBSERVATIONS) + 1);
  }
  return counts;
};

/*
 * The ratio answers "did something systemic just happen to this calendar", so it is taken
 * against the mappings of the calendar losing its copies and not against every mapping on
 * the destination: a sibling source calendar large enough to dilute the ratio would
 * otherwise wave a whole calendar's worth of deletions through unasked. The destination
 * wide ratio is kept beside it, because a fleet of one-mapping calendars all vanishing
 * together trips that one and no per-calendar one. The ceiling is checked at both scopes
 * for the same reason a ratio needs one at all: a batch can be diluted by the mappings it
 * left alone within a calendar, and spread thin across calendars so that neither ratio
 * sees it, and the count is the only bound that survives both.
 */
const resolveTrippedSourceCalendarIds = (
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[],
  candidates: { mapping: EventMapping }[],
  floor: number,
  ratio: number,
  ceiling: number = Number.POSITIVE_INFINITY,
): Set<string> => {
  const candidateCounts = countBySourceCalendar(candidates);
  const dilutedByCalendars = candidates.length > ceiling;
  if (dilutedByCalendars
    || (candidates.length > floor && candidates.length / eligible.length > ratio)) {
    return new Set(candidateCounts.keys());
  }

  const eligibleCounts = countBySourceCalendar(eligible);
  const tripped = new Set<string>();
  for (const [sourceCalendarId, candidateCount] of candidateCounts) {
    const total = eligibleCounts.get(sourceCalendarId) ?? candidateCount;
    if (candidateCount > ceiling || (candidateCount > floor && candidateCount / total > ratio)) {
      tripped.add(sourceCalendarId);
    }
  }
  return tripped;
};

const isDeletionRefused = (context: MappingContext): boolean => {
  const { mapping, policy, scope } = context;
  if (policy.writeBackMode !== "edits_and_deletes" || !scope.authoritativeWindow) {
    return true;
  }
  return mapping.eventStateId !== null
    && Boolean(scope.withheldSourceEventStateIds?.has(mapping.eventStateId));
};

const clearPendingDeleteUpdate = (mapping: EventMapping): PendingUpdate => ({
  id: mapping.id,
  missingFirstObservedAt: null,
  missingObservationCount: NO_OBSERVATIONS,
});

const classifyMissingMirror = (context: MappingContext): MappingOutcome => {
  const { counters, localEvent, mapping, now, projectedEvent } = context;
  if (isRecurringMapping(mapping)) {
    /*
     * Refusing the deletion must hand the mapping back to the ordinary re-create path.
     * Suppressing it as well would leave the mirror neither deleted nor restored, which is
     * a divergence the user can never resolve.
     */
    return {
      classification: {
        mappingId: mapping.id,
        reason: "recurring_event",
        type: "rejected",
        ...(hasPendingDeleteState(mapping) && {
          mappingUpdate: clearPendingDeleteUpdate(mapping),
        }),
      },
      suppress: false,
    };
  }
  if (isDeletionRefused(context)) {
    return { suppress: false };
  }
  /*
   * Absence is only evidence of a user deleting the copy if Keeper ever saw that copy
   * alive under this policy. A mapping with no witness is one write-back has never
   * observed — the pass that enabled two-way sync, or the pass after a mode change reset
   * the witnesses — so its absence predates the consent and belongs to the ordinary
   * re-create path. Any delete clock carried across that boundary is cleared with it.
   */
  if (!isWitnessRecorded(mapping)) {
    return {
      classification: {
        mappingId: mapping.id,
        reason: "never_observed",
        type: "rejected",
        ...(hasPendingDeleteState(mapping) && {
          mappingUpdate: clearPendingDeleteUpdate(mapping),
        }),
      },
      suppress: false,
    };
  }
  if (mapping.syncEventHash !== createSyncEventContentHash(projectedEvent)) {
    counters.conflictSourceWins += FIRST_OBSERVATION;
    return {
      classification: {
        mappingId: mapping.id,
        resolution: "source-wins",
        type: "conflict",
        ...(hasPendingDeleteState(mapping) && {
          mappingUpdate: clearPendingDeleteUpdate(mapping),
        }),
      },
      suppress: false,
    };
  }

  const missingObservationCount = (mapping.missingObservationCount ?? NO_OBSERVATIONS)
    + FIRST_OBSERVATION;
  const missingFirstObservedAt = mapping.missingFirstObservedAt ?? now;
  const graceElapsed = now.getTime() - missingFirstObservedAt.getTime()
    >= TWO_WAY_DELETE_GRACE_MS;
  const pending: PendingDelete = {
    deleteApproved: isApprovedFirstObservation(missingFirstObservedAt, context.policy),
    localEvent,
    mapping,
    missingFirstObservedAt,
    missingObservationCount,
  };

  if (missingObservationCount >= TWO_WAY_DELETE_MIN_OBSERVATIONS && graceElapsed) {
    return { pendingDelete: pending, suppress: true };
  }
  return { classification: createDeleteCandidate(pending), suppress: true };
};

/*
 * Withholding the deletion is not the same as forgetting what the read showed. The clock
 * is what a later answer is measured against: without it, every disappearance would look
 * newer than the approval that was given for it and the question could never be settled.
 * Recording is not acting — nothing is written to either calendar from here.
 */
const recordHeldDisappearance = (
  context: MappingContext,
): InboundClassification | null => {
  const { localEvent, mapping, now, projectedEvent } = context;
  const undeletable = isRecurringMapping(mapping)
    || isDeletionRefused(context)
    || !isWitnessRecorded(mapping)
    || mapping.syncEventHash !== createSyncEventContentHash(projectedEvent);
  if (undeletable) {
    return null;
  }
  return createDeleteCandidate({
    deleteApproved: isApprovedDisappearance(mapping, context.policy),
    localEvent,
    mapping,
    missingFirstObservedAt: mapping.missingFirstObservedAt ?? now,
    missingObservationCount: (mapping.missingObservationCount ?? NO_OBSERVATIONS)
      + FIRST_OBSERVATION,
  });
};

const createQuiescentOutcome = (
  mapping: EventMapping,
  released: boolean,
): MappingOutcome => ({
  classification: {
    mappingId: mapping.id,
    missingObservationCount: NO_OBSERVATIONS,
    type: "none",
    ...(hasPendingDeleteState(mapping) && {
      mappingUpdate: {
        id: mapping.id,
        missingFirstObservedAt: null,
        missingObservationCount: NO_OBSERVATIONS,
      },
    }),
  },
  /*
   * The ordinary stale check compares the mirror against what we would push now, so a
   * destination that normalizes on write reads as permanently stale there. The witness
   * has already settled that question, so only a source-side change may still push.
   */
  suppress: !released,
});

const createRejection = (
  mapping: EventMapping,
  observed: ObservedDestinationState,
  reason: WriteBackRejectionReason,
  released: boolean,
): MappingOutcome => ({
  classification: {
    mappingId: mapping.id,
    mappingUpdate: createWitnessUpdate(mapping.id, observed),
    observed,
    reason,
    type: "rejected",
  },
  suppress: !released,
});

interface DriftResolution {
  availabilityRejected: boolean;
  conflicted: boolean;
  rejectedFields: WriteBackField[];
  rejectionReason: WriteBackRejectionReason | null;
  sourceNonTimeDrifted: boolean;
  sourceTimeDrifted: boolean;
  updates: WriteBackUpdates;
}

/*
 * A schedule write carries three fields, never one. Google and Outlook read the all-day
 * flag from the shape of the start and end they are handed, so sending a bare instant for
 * an event the source holds as all-day rewrites a real all-day event into a timed one.
 */
const NO_CONTENT_UPDATES: ContentUpdates = {
  allDayChanged: false,
  observedIsAllDay: false,
  rejected: false,
  rejectedFields: [],
  text: {},
};

const resolveContentUpdates = (
  mapping: EventMapping,
  observed: ObservedDestinationState,
  drift: DestinationDrift,
  eligibleFields: ReadonlySet<WriteBackField>,
): ContentUpdates => {
  if (!drift.content) {
    return NO_CONTENT_UPDATES;
  }
  return collectContentUpdates(mapping, observed, eligibleFields);
};

const resolveScheduleAuthority = (
  localEvent: MaterializedSyncableEvent,
  observed: ObservedDestinationState,
  destinationTimeDrifted: boolean,
): { endTime: Date; startTime: Date } => {
  if (destinationTimeDrifted) {
    return { endTime: observed.endTime, startTime: observed.startTime };
  }
  return { endTime: localEvent.endTime, startTime: localEvent.startTime };
};

const resolveWrittenIsAllDay = (
  localEvent: MaterializedSyncableEvent,
  content: ContentUpdates,
): boolean => {
  if (content.allDayChanged) {
    return content.observedIsAllDay;
  }
  return resolveLocalIsAllDay(localEvent);
};

/*
 * No destination reports a timezone, so none is ever propagated. The source's own zone
 * travels beside the instants because a provider handed a bare instant re-homes the event
 * to its calendar default: a preservation, never a propagation.
 */
const resolveScheduleUpdates = (
  localEvent: MaterializedSyncableEvent,
  observed: ObservedDestinationState,
  content: ContentUpdates,
  destinationTimeDrifted: boolean,
): WriteBackUpdates => ({
  ...resolveScheduleAuthority(localEvent, observed, destinationTimeDrifted),
  isAllDay: resolveWrittenIsAllDay(localEvent, content),
  ...(localEvent.startTimeZone && { startTimeZone: localEvent.startTimeZone }),
});

const resolveDrift = (
  context: MappingContext,
  remoteEvent: RemoteEvent,
  observed: ObservedDestinationState,
  drift: DestinationDrift,
  eligibleFields: ReadonlySet<WriteBackField>,
): DriftResolution => {
  const { counters, localEvent, mapping, projectedEvent } = context;
  const sourceTimeDrifted = !isSameSerializedSecond(projectedEvent.startTime, mapping.startTime)
    || !isSameSerializedSecond(projectedEvent.endTime, mapping.endTime);
  const sourceNonTimeDrifted = mapping.syncEventHash !== createSyncEventContentHash({
    ...projectedEvent,
    endTime: mapping.endTime,
    startTime: mapping.startTime,
  });
  const content = resolveContentUpdates(mapping, observed, drift, eligibleFields);

  let conflicted = false;
  let rejectionReason: WriteBackRejectionReason | null = null;
  let updates: WriteBackUpdates = {};

  if (content.rejected) {
    rejectionReason = "redacted_field";
    counters.blockedRedactedField += FIRST_OBSERVATION;
  }

  const wantsScheduleWrite = drift.time || content.allDayChanged;
  if (wantsScheduleWrite) {
    if (sourceTimeDrifted || (content.allDayChanged && sourceNonTimeDrifted)) {
      conflicted = true;
    } else {
      updates = resolveScheduleUpdates(localEvent, observed, content, drift.time);
    }
  }

  const hasWritableText = Object.keys(content.text).length > NO_OBSERVATIONS;
  if (hasWritableText) {
    if (sourceNonTimeDrifted) {
      conflicted = true;
    } else {
      updates = { ...updates, ...content.text };
    }
  }

  /*
   * No payload ever carries availability, so an availability edit is always swallowed and
   * the count is what makes it visible. It is taken before the reason is weighed, because
   * a payload from another axis discards the reason but not the discarded edit.
   */
  let availabilityRejected = false;
  if (drift.availability) {
    counters.blockedAvailability += FIRST_OBSERVATION;
    availabilityRejected = true;
    rejectionReason = resolveAvailabilityRejection(localEvent, remoteEvent);
  }

  return {
    availabilityRejected,
    conflicted,
    rejectedFields: content.rejectedFields,
    rejectionReason,
    sourceNonTimeDrifted,
    sourceTimeDrifted,
    updates,
  };
};

/*
 * The witness is what the next pass measures drift against, so it may only ever record the
 * axes this pass could actually carry to the source. Recording the copy's value on an axis
 * the payload never carried — an availability the source cannot express, a field the pair
 * is configured to hide — would make the witness agree with the copy: drift would read as
 * zero on the next pass, one-way repair is barred from a mapping write-back is holding, and
 * the divergence would be invisible for good. Keeping the recorded value instead leaves the
 * drift standing until the repair path puts the copy back.
 */
const revertRejectedContentField = (
  mapping: EventMapping,
  field: WriteBackField,
): Partial<ObservedDestinationState> => {
  if (field === "summary") {
    return { summary: mapping.destinationSummary ?? "" };
  }
  if (field === "description") {
    return { description: mapping.destinationDescription ?? "" };
  }
  return { location: mapping.destinationLocation ?? "" };
};

const resolveRecordedWitness = (
  mapping: EventMapping,
  observed: ObservedDestinationState,
  resolution: DriftResolution,
): ObservedDestinationState => {
  const contentReverts = resolution.rejectedFields.map((field) =>
    revertRejectedContentField(mapping, field)
  );
  return {
    ...observed,
    ...(resolution.availabilityRejected && {
      availability: mapping.destinationAvailability ?? null,
    }),
    ...Object.assign({}, ...contentReverts) as Partial<ObservedDestinationState>,
    ...(resolution.rejectedFields.length > NO_OBSERVATIONS && {
      contentHash: mapping.destinationContentHash ?? observed.contentHash,
    }),
  };
};

/*
 * The recorded push hash must describe the state the copy actually holds, never the state
 * of the source. A payload that writes one axis while the source is carrying an unpushed
 * change on another would otherwise mark that change as already delivered, leaving the
 * copy stably wrong with nothing left to notice it.
 */
const resolveProjectedSyncEventHash = (
  projectedEvent: MaterializedSyncableEvent,
  mapping: EventMapping,
  resolution: DriftResolution,
): string | null => {
  if ("startTime" in resolution.updates) {
    if (resolution.sourceNonTimeDrifted) {
      return null;
    }
    return createSyncEventContentHash({ ...projectedEvent, ...resolution.updates });
  }
  if (resolution.sourceTimeDrifted) {
    return createSyncEventContentHash({
      ...projectedEvent,
      endTime: mapping.endTime,
      startTime: mapping.startTime,
      ...resolution.updates,
    });
  }
  return createSyncEventContentHash({ ...projectedEvent, ...resolution.updates });
};

/*
 * Both availability rejections are the same fact: the edit cannot reach the source. A clamp
 * is if anything the more dangerous of the two, because the value the copy is supposed to
 * carry is one Keeper.sh chose for a destination that cannot hold the source's own — so
 * nothing but the recorded witness knows what the copy is meant to say.
 */
const resolveAvailabilityOnlyRejection = (
  drift: DestinationDrift,
  rejectionReason: WriteBackRejectionReason | null,
): WriteBackRejectionReason | null => {
  if (!drift.availability || drift.content || drift.time) {
    return null;
  }
  if (
    rejectionReason === "availability_not_writable"
    || rejectionReason === "availability_clamped"
  ) {
    return rejectionReason;
  }
  return null;
};

/*
 * Rendering-tolerant, so it reports only what a destination re-encoding what we wrote
 * cannot explain. It still cannot separate that from a user edit made before the copy
 * was ever read: one observation carries no evidence either way, and the copy is adopted
 * rather than rebuilt because rebuilding it loops forever against any destination that
 * normalizes. The count is the whole of what this divergence surfaces today.
 */
const hasDivergedFromPush = (
  projectedEvent: MaterializedSyncableEvent,
  mapping: EventMapping,
  observed: ObservedDestinationState,
): boolean =>
  hasFieldMoved(observed.summary, projectedEvent.summary)
  || hasFieldMoved(observed.description, projectedEvent.description)
  || hasFieldMoved(observed.location, projectedEvent.location)
  || observed.isAllDay !== resolveLocalIsAllDay(projectedEvent)
  || !isSameSerializedSecond(observed.startTime, mapping.startTime)
  || !isSameSerializedSecond(observed.endTime, mapping.endTime);

/*
 * A rejection says the edit cannot reach the source. It must not also say the copy keeps
 * it: recording the user's own edit as the new baseline leaves the destination stably
 * wrong, with the witness agreeing with it and nothing left anywhere to notice. That is
 * the one outcome worse than either writing the edit back or putting the copy back, and
 * it contradicts what the product tells the user a repeating event or a hidden field
 * does. So a copy that has really moved away from what we pushed is handed to the
 * ordinary repair path with its witness left alone, exactly as one-way sync treats it.
 * The witness is still adopted when nothing has really moved — a destination re-encoding
 * its own copy of our push — because rebuilding that on every pass never terminates.
 */
const createUnwritableRejection = (
  context: MappingContext,
  observed: ObservedDestinationState,
  witness: ObservedDestinationState,
  reason: WriteBackRejectionReason,
  released: boolean,
): MappingOutcome => {
  const { mapping, projectedEvent } = context;
  if (hasDivergedFromPush(projectedEvent, mapping, observed)) {
    return {
      classification: { mappingId: mapping.id, observed, reason, type: "rejected" },
      suppress: false,
    };
  }
  return createRejection(mapping, witness, reason, released);
};

const classifyPresentMirror = (
  context: MappingContext,
  remoteEvent: RemoteEvent,
  observed: ObservedDestinationState,
): MappingOutcome => {
  const { counters, localEvent, mapping, now, policy, projectedEvent } = context;
  const drift = getDestinationDrift(mapping, remoteEvent);
  const outbound = mapping.syncEventHash !== createSyncEventContentHash(projectedEvent);
  /*
   * The copy answered under a delete identifier the mapping does not hold, so the
   * recorded one is stale and every targeted read of the copy — the probe that guards
   * every source deletion among them — would answer not-found on an event that is
   * plainly there. Only the ordinary reconciliation path records the new identifier, so
   * the mapping is released to it rather than held here.
   */
  const identityStale = remoteEvent.deleteId !== mapping.deleteIdentifier;
  const released = outbound || identityStale;

  if (!isWitnessRecorded(mapping)) {
    if (outbound) {
      return { suppress: false };
    }
    /*
     * An edit made between a push and the first read of the copy is byte-identical to a
     * provider normalizing that push, so it is adopted rather than written back. The
     * divergence is counted so the swallowed edit is visible rather than silent.
     */
    if (hasDivergedFromPush(projectedEvent, mapping, observed)) {
      counters.adoptWindowDivergence += FIRST_OBSERVATION;
    }
    return {
      classification: {
        mappingId: mapping.id,
        mappingUpdate: createWitnessUpdate(mapping.id, observed),
        observed,
        type: "adopt-baseline",
      },
      suppress: !identityStale,
    };
  }

  if (!drift.availability && !drift.content && !drift.time) {
    return createQuiescentOutcome(mapping, released);
  }

  if (isRecurringMapping(mapping)) {
    return createUnwritableRejection(context, observed, observed, "recurring_event", released);
  }

  /*
   * The budget is spent because this mapping has already written to a real calendar as
   * many times as it is ever allowed to. Handing the copy to the repair path would rebuild
   * the mapping, and a rebuilt mapping carries neither a witness nor a spent budget — so
   * the destination that exhausted the budget would be handed a fresh one on the next
   * pass, and the source would be written to without bound. The copy is adopted, and the
   * pair's quarantine is what tells the user their edit went nowhere.
   */
  if (isBudgetSpent(mapping, now)) {
    return createRejection(mapping, observed, "write_back_quarantined", released);
  }

  const eligibleFields = resolveWriteBackEligibleFields(policy);
  const resolution = resolveDrift(context, remoteEvent, observed, drift, eligibleFields);

  /*
   * Availability is the one axis no payload carries, so an edit to it can never reach the
   * source. Recording the copy's value as the new baseline would accept a busy block
   * silently downgraded to free for good, which is the opposite of what the product exists
   * to project. The copy is handed back to the ordinary repair path and the recorded value
   * is left alone, so the divergence stays visible until the repair lands.
   */
  const availabilityOnlyRejection = resolveAvailabilityOnlyRejection(
    drift,
    resolution.rejectionReason,
  );
  if (availabilityOnlyRejection) {
    return {
      classification: {
        mappingId: mapping.id,
        reason: availabilityOnlyRejection,
        type: "rejected",
      },
      suppress: false,
    };
  }

  if (resolution.conflicted) {
    counters.conflictSourceWins += FIRST_OBSERVATION;
    return {
      classification: { mappingId: mapping.id, resolution: "source-wins", type: "conflict" },
      suppress: false,
    };
  }

  const recordedWitness = resolveRecordedWitness(mapping, observed, resolution);

  if (Object.keys(resolution.updates).length > NO_OBSERVATIONS) {
    assertWriteBackPayload(resolution.updates, eligibleFields);
    return {
      classification: {
        expectedSource: collectExpectedSource(localEvent, resolution.updates),
        expectedSyncEventHash: mapping.syncEventHash,
        mappingId: mapping.id,
        observed: recordedWitness,
        projectedSyncEventHash: resolveProjectedSyncEventHash(
          projectedEvent,
          mapping,
          resolution,
        ),
        sourceEventUid: localEvent.sourceEventUid,
        type: "write-back",
        updates: resolution.updates,
      },
      suppress: true,
    };
  }

  if (resolution.rejectionReason) {
    return createUnwritableRejection(
      context,
      observed,
      recordedWitness,
      resolution.rejectionReason,
      released,
    );
  }

  /*
   * The axis moved but no field moved against its own recorded value, so the drift was
   * the destination re-encoding what we wrote. Record what it reported now and act on
   * nothing, or the same re-encoding is re-read as an edit on every pass.
   */
  return {
    classification: {
      mappingId: mapping.id,
      mappingUpdate: createWitnessUpdate(mapping.id, observed),
      observed,
      type: "adopt-baseline",
    },
    suppress: !released,
  };
};

interface PendingWriteBack {
  classification: Extract<InboundClassification, { type: "write-back" }>;
  mapping: EventMapping;
  suppress: boolean;
}

/*
 * The witness is deliberately left alone on a held edit. Recording the destination's
 * values as the new baseline would accept a change nobody asked for and leave nothing
 * anywhere to notice; leaving it means the copies are rebuilt from the source by the
 * ordinary repair, which is the one direction that destroys nothing.
 */
const resolveEditBreaker = (
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[],
  pendingWriteBacks: PendingWriteBack[],
): {
  classifications: InboundClassification[];
  suppressedMappingIds: string[];
  trippedSourceCalendarIds: Set<string>;
} => {
  const trippedSourceCalendarIds = resolveTrippedSourceCalendarIds(
    eligible,
    pendingWriteBacks,
    TWO_WAY_EDIT_ABSOLUTE_FLOOR,
    TWO_WAY_EDIT_RATIO,
    TWO_WAY_EDIT_ABSOLUTE_CEILING,
  );
  const classifications: InboundClassification[] = [];
  const suppressedMappingIds: string[] = [];

  for (const { classification, mapping, suppress } of pendingWriteBacks) {
    const heldByBreaker = mapping.sourceCalendarId !== null
      && trippedSourceCalendarIds.has(mapping.sourceCalendarId);
    if (heldByBreaker) {
      classifications.push({
        mappingId: mapping.id,
        observed: classification.observed,
        reason: "bulk_edit_breaker",
        type: "rejected",
        ...(classification.mappingUpdate && {
          mappingUpdate: classification.mappingUpdate,
        }),
      });
      continue;
    }
    classifications.push(classification);
    if (suppress) {
      suppressedMappingIds.push(mapping.id);
    }
  }

  return { classifications, suppressedMappingIds, trippedSourceCalendarIds };
};

const readObservedState = (
  remoteEvent: RemoteEvent,
): ObservedDestinationState | null => {
  const contentHash = remoteEvent.editableContentHash;
  const fields = remoteEvent.editableFields;
  if (typeof contentHash !== "string" || !fields) {
    return null;
  }
  return {
    availability: remoteEvent.editableAvailability ?? null,
    contentHash,
    description: normalizeText(fields.description),
    endTime: remoteEvent.endTime,
    isAllDay: resolveIsAllDayEvent({
      endTime: remoteEvent.endTime,
      isAllDay: fields.isAllDay,
      startTime: remoteEvent.startTime,
    }),
    location: normalizeText(fields.location),
    startTime: remoteEvent.startTime,
    summary: normalizeText(fields.summary),
  };
};

/*
 * The copy answered this listing, so whichever earlier absence started the delete clock
 * was the provider not returning it, not the user destroying it. Retiring the clock here
 * covers every branch that acts on a present copy at once: leaving it standing on the
 * branches that record nothing lets a copy flickering out of two listings a minute apart
 * satisfy a guard written to require ten continuous minutes of absence.
 */
const clearPendingDeleteOnObservation = (
  mapping: EventMapping,
  outcome: MappingOutcome,
): MappingOutcome => {
  if (!hasPendingDeleteState(mapping)) {
    return outcome;
  }
  const { classification } = outcome;
  if (!classification) {
    return {
      ...outcome,
      classification: {
        mappingId: mapping.id,
        mappingUpdate: clearPendingDeleteUpdate(mapping),
        missingObservationCount: NO_OBSERVATIONS,
        type: "none",
      },
    };
  }
  if (classification.type === "delete") {
    return outcome;
  }
  if (classification.mappingUpdate) {
    return outcome;
  }
  return {
    ...outcome,
    classification: {
      ...classification,
      mappingUpdate: clearPendingDeleteUpdate(mapping),
    },
  };
};

const classifyMapping = (
  context: MappingContext,
  remoteEvent?: RemoteEvent,
): MappingOutcome => {
  if (!remoteEvent) {
    return classifyMissingMirror(context);
  }
  const observed = readObservedState(remoteEvent);
  if (!observed) {
    return clearPendingDeleteOnObservation(context.mapping, { suppress: false });
  }
  return clearPendingDeleteOnObservation(
    context.mapping,
    classifyPresentMirror(context, remoteEvent, observed),
  );
};

interface MappingPassResult {
  classifications: InboundClassification[];
  pendingDeletes: PendingDelete[];
  pendingWriteBacks: PendingWriteBack[];
  suppressedMappingIds: string[];
}

const runMappingPass = (input: {
  counters: InboundCounters;
  eligible: { mapping: EventMapping; policy: WriteBackPolicy }[];
  heldSourceCalendarIds: ReadonlySet<string>;
  localEventsById: ReadonlyMap<string | null, MaterializedSyncableEvent>;
  now: Date;
  projectLocalEvent: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  remoteEventsByMappingId: ReadonlyMap<string, RemoteEvent>;
  scope: ReconciliationScope;
}): MappingPassResult => {
  const result: MappingPassResult = {
    classifications: [],
    pendingDeletes: [],
    pendingWriteBacks: [],
    suppressedMappingIds: [],
  };

  for (const { mapping, policy } of input.eligible) {
    const held = mapping.sourceCalendarId !== null
      && input.heldSourceCalendarIds.has(mapping.sourceCalendarId);
    const localEvent = input.localEventsById.get(mapping.syncEventId);
    if (!localEvent) {
      continue;
    }
    const projectedEvent = input.projectLocalEvent(localEvent);
    if (held) {
      const recorded = recordHeldDisappearance({
        counters: input.counters,
        localEvent,
        mapping,
        now: input.now,
        policy,
        projectedEvent,
        scope: input.scope,
      });
      if (recorded) {
        result.classifications.push(recorded);
      }
      continue;
    }
    /*
     * The pair is waiting on a human answer about copies that vanished. Acting on any of
     * them would pre-empt the answer, and letting the missing ones be re-created would
     * reset the very pending state the answer applies to. The copies that are still there
     * are held for the same span: the pair writes nothing back while it waits, so
     * rebuilding one would silently discard an edit the user made on it — with no
     * write-back to carry that edit anywhere — while they were being asked about
     * something else entirely.
     */
    if (policy.paused) {
      result.suppressedMappingIds.push(mapping.id);
      continue;
    }
    const outcome = classifyMapping(
      {
        counters: input.counters,
        localEvent,
        mapping,
        now: input.now,
        policy,
        projectedEvent,
        scope: input.scope,
      },
      input.remoteEventsByMappingId.get(mapping.id),
    );
    /*
     * A write-back is held back until the pass has counted every one of them: a change
     * that moved the whole destination at once is only recognisable from the total.
     */
    if (outcome.classification?.type === "write-back") {
      result.pendingWriteBacks.push({
        classification: outcome.classification,
        mapping,
        suppress: outcome.suppress,
      });
      continue;
    }
    if (outcome.classification) {
      result.classifications.push(outcome.classification);
    }
    if (outcome.pendingDelete) {
      result.pendingDeletes.push(outcome.pendingDelete);
    }
    if (outcome.suppress) {
      result.suppressedMappingIds.push(mapping.id);
    }
  }

  return result;
};

const classifyInboundChanges = (
  input: ClassifyInboundChangesInput,
): InboundClassificationResult => {
  const {
    existingMappings,
    localEvents,
    now,
    remoteEvents,
    remoteRawItemCount,
    scope,
  } = input;
  const projectLocalEvent = input.projectLocalEvent ?? ((event) => event);
  const counters = createCounters();
  const classifications: InboundClassification[] = [];
  const suppressedMappingIds: string[] = [];
  const readHealth = resolveReadHealth(
    remoteEvents.length,
    remoteRawItemCount,
    existingMappings.length,
  );
  const policies = scope.writeBackPolicies ?? new Map<string, WriteBackPolicy>();
  const eligible = resolveEligibleMappings(existingMappings, policies, scope);

  if (eligible.length === NO_OBSERVATIONS) {
    return {
      classifications,
      counters,
      deleteBreakerTripped: false,
      deleteConfirmation: null,
      healthyReadSourceCalendarIds: [],
      readHealth,
      suppressedMappingIds,
      writeBackHold: null,
    };
  }

  /*
   * A read that returned literally nothing cannot tell an emptied calendar from a broken
   * connection, so it holds for an answer. Only the calendar the answer was given for
   * proceeds: each of its deletions is still confirmed against the copy itself before
   * anything on the source is touched, which is the check that distinguishes the two cases.
   */
  const healthyReadSourceCalendarIds = resolveHealthyReadSourceCalendarIds(
    readHealth,
    eligible,
  );
  const heldSourceCalendarIds = resolveHeldSourceCalendarIds(readHealth, eligible);
  const heldEligible = eligible.filter(({ mapping }) =>
    mapping.sourceCalendarId !== null && heldSourceCalendarIds.has(mapping.sourceCalendarId));
  let emptyReadConfirmation: DeleteConfirmationRequest | null = null;

  if (heldEligible.length > NO_OBSERVATIONS) {
    counters.ambiguousEmptyRead = FIRST_OBSERVATION;
    suppressedMappingIds.push(...heldEligible.map(({ mapping }) => mapping.id));
    emptyReadConfirmation = {
      reason: "all_copies_missing",
      sourceCalendarIds: collectDeletingSourceCalendarIds(eligible, heldSourceCalendarIds),
    };
  }

  const localEventsById = new Map(
    localEvents
      .filter((event) => isInsideSourceAuthoritativeWindow(event, event.calendarId, scope))
      .map((event) => [event.id, event]),
  );
  const remoteEventsByMappingId = matchRemoteEventsToMappings(
    eligible.map(({ mapping }) => mapping),
    remoteEvents,
  );
  const pass = runMappingPass({
    counters,
    eligible,
    heldSourceCalendarIds,
    localEventsById,
    now,
    projectLocalEvent,
    remoteEventsByMappingId,
    scope,
  });
  classifications.push(...pass.classifications);
  suppressedMappingIds.push(...pass.suppressedMappingIds);
  const { pendingDeletes, pendingWriteBacks } = pass;

  const editBreaker = resolveEditBreaker(eligible, pendingWriteBacks);
  classifications.push(...editBreaker.classifications);
  suppressedMappingIds.push(...editBreaker.suppressedMappingIds);
  if (editBreaker.trippedSourceCalendarIds.size > NO_OBSERVATIONS) {
    counters.editBreakerTripped = FIRST_OBSERVATION;
  }

  /*
   * A deletion a human has already answered for is not a candidate the breaker is
   * protecting against: leaving it in the count would re-trip on the very answer that was
   * given, and the pair could never finish the bulk deletion it was asked about.
   */
  const unapprovedDeletes = pendingDeletes.filter(({ deleteApproved }) => !deleteApproved);
  const trippedSourceCalendarIds = resolveTrippedSourceCalendarIds(
    eligible,
    unapprovedDeletes,
    TWO_WAY_DELETE_ABSOLUTE_FLOOR,
    TWO_WAY_DELETE_RATIO,
    TWO_WAY_DELETE_ABSOLUTE_CEILING,
  );
  const deleteBreakerTripped = trippedSourceCalendarIds.size > NO_OBSERVATIONS;

  if (deleteBreakerTripped) {
    counters.deleteBreakerTripped = FIRST_OBSERVATION;
  }

  for (const pending of pendingDeletes) {
    const heldByBreaker = !pending.deleteApproved
      && pending.mapping.sourceCalendarId !== null
      && trippedSourceCalendarIds.has(pending.mapping.sourceCalendarId);
    if (heldByBreaker) {
      classifications.push(createDeleteCandidate(pending));
      continue;
    }
    classifications.push({
      expectedSource: collectExpectedSourceForDelete(pending.localEvent),
      expectedSyncEventHash: pending.mapping.syncEventHash,
      mappingId: pending.mapping.id,
      sourceEventUid: pending.localEvent.sourceEventUid,
      type: "delete",
    });
  }

  return {
    classifications,
    counters,
    deleteBreakerTripped,
    deleteConfirmation: emptyReadConfirmation
      ?? createBreakerConfirmation(trippedSourceCalendarIds),
    healthyReadSourceCalendarIds,
    readHealth,
    suppressedMappingIds,
    writeBackHold: createWriteBackHold(editBreaker.trippedSourceCalendarIds),
  };
};

export {
  assertWriteBackPayload,
  classifyInboundChanges,
  getDestinationDrift,
  resolveWriteBackEligibleFields,
  TWO_WAY_DELETE_ABSOLUTE_FLOOR,
  TWO_WAY_DELETE_GRACE_MS,
  TWO_WAY_DELETE_MIN_OBSERVATIONS,
  TWO_WAY_DELETE_RATIO,
  TWO_WAY_EDIT_ABSOLUTE_CEILING,
  TWO_WAY_EDIT_ABSOLUTE_FLOOR,
  TWO_WAY_EDIT_RATIO,
  TWO_WAY_EPOCH_QUARANTINE_LIMIT,
  TWO_WAY_EPOCH_WINDOW_MS,
  TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT,
};
export type {
  DeleteConfirmationRequest,
  DestinationDrift,
  ExpectedSourceFields,
  InboundClassification,
  InboundClassificationResult,
  InboundCounters,
  ObservedDestinationState,
  ReadHealth,
  WriteBackHoldRequest,
  WriteBackRejectionReason,
};

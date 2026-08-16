import {
  DEFAULT_EVENT_NAME,
  isWriteBackMode,
  normalizeText,
  resolveIsAllDayEvent,
  resolveWriteBackPolicyState,
  TWO_WAY_EPOCH_QUARANTINE_LIMIT,
  TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT,
} from "@keeper.sh/calendar";
import type {
  CalendarSourceWriter,
  ExpectedSourceFields,
  InboundClassification,
  RemoteEventPresence,
  WriteBackUpdates,
} from "@keeper.sh/calendar";
import {
  TWO_WAY_DELETE_DAILY_CAP,
  TWO_WAY_DELETE_DAILY_WINDOW_MS,
  TWO_WAY_WRITE_BACK_DAILY_CAP,
  TWO_WAY_WRITE_BACK_PASS_BUDGET_MS,
} from "@keeper.sh/constants";

const MAX_WRITE_BACKS_PER_PASS = 25;
const NO_WORK = 0;

/*
 * The hourly epoch is renewed by any oscillation slower than its threshold, so the
 * rolling day is what stops a destination that varies a few times an hour from writing
 * to a real calendar forever.
 */
class WriteBackDailyCapError extends Error {
  constructor(mappingId: string) {
    super(`Write-back daily cap spent for mapping ${mappingId}`);
    this.name = "WriteBackDailyCapError";
  }
}

/*
 * The provider was reachable and the write was understood; it was declined because
 * applying it would reach past the user — cancelling a meeting for its attendees, or
 * moving it on their calendars. No retry changes that, so it is not a failure to spend a
 * budget on: the pair stops writing to this source and the user is told why.
 */
class SourceWriteRefusedError extends Error {
  readonly refusal: string;

  constructor(refusal: string) {
    super(`Source write refused: ${refusal}`);
    this.name = "SourceWriteRefusedError";
    this.refusal = refusal;
  }
}

/*
 * The provider was asked and answered, and the answer was no: a rate limit, a permission,
 * a 5xx. Nothing on the source was destroyed or changed by any of them, which is what
 * separates this from an answer that never arrived at all. It is still a failure — the
 * epoch budget is spent on it and the pair quarantines once that runs out — but it must
 * not be recorded as a source event Keeper.sh deleted today.
 */
class SourceWriteRejectedError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SourceWriteRejectedError";
    this.retryable = retryable;
  }
}

/*
 * A throttle, a gateway failure or a connection that never opened is the provider saying
 * "not right now", and pausing the pair over one is not a safe default: it reverts to
 * one-way, rebuilds the edited copy from the original and discards the edit the user made
 * — permanently, over an outage that would have cleared by the next pass, and with nothing
 * retried once the pair is off. So a retryable answer is retried. It is still counted, on
 * a budget long enough to outlast an ordinary throttle and short enough that a provider
 * which never recovers ends in a paused pair the user is told about rather than in a
 * silent loop: at the one-minute cadence a Pro mapping runs, this is about half an hour of
 * sustained rejection. The limit is the classifier's own, because a mapping the classifier
 * has stopped handing over is never retried again however long this budget still has to run.
 */
const resolveQuarantineLimit = (error: unknown): number => {
  if (error instanceof SourceWriteRejectedError && error.retryable) {
    return TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT;
  }
  return TWO_WAY_EPOCH_QUARANTINE_LIMIT;
};

const QUARANTINE_REASONS_BY_REFUSAL: Record<string, string> = {
  event_body_is_rich_text: "source_event_rich_body",
  event_has_attendees: "source_event_has_attendees",
};

const resolveQuarantineReason = (refusal: string): string =>
  QUARANTINE_REASONS_BY_REFUSAL[refusal] ?? "source_write_refused";

const assertWriteAccepted = (written: {
  error?: string;
  refused?: string;
  retryable?: boolean;
  success: boolean;
}, fallback: string): void => {
  if (written.refused) {
    throw new SourceWriteRefusedError(written.refused);
  }
  if (!written.success) {
    throw new SourceWriteRejectedError(
      written.error ?? fallback,
      written.retryable === true,
    );
  }
};

class UnusableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableSourceError";
  }
}

interface WriteBackTarget {
  deleteIdentifier?: string;
  destinationCalendarId: string;
  destinationEventUid?: string;
  eventStateId: string;
  mappingId: string;
  sourceCalendarId: string;
  sourceEventId: string | null;
  sourceEventUid: string;
}

interface SourceEventSnapshot {
  description: string | null;
  endTime: Date;
  isAllDay: boolean | null;
  location: string | null;
  startTime: Date;
  startTimeZone: string | null;
  title: string | null;
}

interface CommitUpdateInput {
  eventStateId: string;
  mappingId: string;
  observed: Extract<InboundClassification, { type: "write-back" }>["observed"];
  projectedSyncEventHash: string | null;
  updates: WriteBackUpdates;
}

interface PairWriteBackAuthority {
  writeBackMode: string;
  writeBackState: string;
}

interface LockedWriteBackStore {
  commitDelete: (input: {
    eventStateId: string;
    mappingId: string;
    tombstoneId: string;
  }) => Promise<void>;
  commitUpdate: (
    input: CommitUpdateInput,
  ) => Promise<{ writeBackDailyCount?: number; writeBackEpoch: number }>;
  /*
   * The policy the classifier ran under was read before the destination listing, and the
   * user can turn two-way sync off at any point in the seconds that follow. Nothing else
   * this applier reads changes when they do, so the pair's own row is re-read here — the
   * last moment before a real calendar is written to — and the write is abandoned rather
   * than performed against a consent that has since been withdrawn.
   */
  readPairWriteBack: (
    pair: { destinationCalendarId: string; sourceCalendarId: string },
  ) => Promise<PairWriteBackAuthority | null>;
  readMappingSyncEventHash: (mappingId: string) => Promise<
    { syncEventHash: string | null } | null
  >;
  readSourceEvent: (eventStateId: string) => Promise<SourceEventSnapshot | null>;
}

interface WriteBackStore {
  /*
   * `observedAt` is what claims the record. Two passes over the same mapping share one
   * row, so a release names the version it wrote: a pass whose row another has since
   * refreshed — or carried to a completed deletion — releases nothing.
   */
  abandonTombstone: (claim: { observedAt: Date; tombstoneId: string }) => Promise<void>;
  countRecentDeletes: (sourceCalendarId: string, since: Date) => Promise<number>;
  loadTarget: (mappingId: string) => Promise<WriteBackTarget | null>;
  /*
   * A list read has no completeness guarantee, so absence from one is a candidate signal
   * and never evidence. The original on the source is destroyed only after a targeted
   * read of the copy answers with a definitive not-found.
   */
  probeDestinationEvent?: (target: WriteBackTarget) => Promise<RemoteEventPresence>;
  notifySiblings: (
    sourceCalendarId: string,
    destinationCalendarId: string,
  ) => Promise<void>;
  quarantineMapping: (
    sourceCalendarId: string,
    destinationCalendarId: string,
    reason: string,
  ) => Promise<void>;
  readSourceEvent: (eventStateId: string) => Promise<SourceEventSnapshot | null>;
  /*
   * A write-back the provider keeps rejecting would otherwise be retried under the source
   * ingest lock once a minute forever, so a failure spends the same budget a success does.
   */
  recordFailure: (mappingId: string) => Promise<number>;
  /*
   * A deletion the copy keeps refusing to confirm is a question, not a failure. Asking it
   * pauses the pair with its pending state intact, which is the only outcome that both
   * ends the retry and tells the user why nothing was deleted.
   */
  requestDeleteConfirmation?: (
    sourceCalendarId: string,
    destinationCalendarId: string,
    reason: string,
  ) => Promise<void>;
  /*
   * `priorAttempt` says an earlier attempt on this mapping left its record unresolved —
   * the timed-out delete the provider may well have carried out. The record is one row
   * per mapping, so releasing it here would uncount a destruction that already happened
   * and hand the day's budget back for events that no longer exist.
   */
  recordTombstone: (input: {
    snapshot: SourceEventSnapshot;
    target: WriteBackTarget;
  }) => Promise<{ id: string; observedAt: Date; priorAttempt: boolean }>;
  resolveWriter: (sourceCalendarId: string) => Promise<CalendarSourceWriter | null>;
  withSourceLock: <TResult>(
    sourceCalendarId: string,
    run: (locked: LockedWriteBackStore) => Promise<TResult>,
  ) => Promise<TResult>;
}

type DeleteBlockedReason = "probe_unavailable" | "probe_unreachable" | "still_present";

interface WriteBackPassInput {
  calendarId: string;
  classifications: InboundClassification[];
  now?: () => Date;
  onDeleteBlocked?: (context: {
    mappingId: string;
    reason: DeleteBlockedReason;
  }) => void;
  onError?: (error: unknown, context: { mappingId: string }) => void;
  signal?: AbortSignal;
  store: WriteBackStore;
}

interface WriteBackPassResult {
  abandoned: number;
  applied: number;
  failed: number;
  quarantined: number;
  withheld: number;
}

/*
 * A quarantine is the decision that this pair can no longer be trusted to write to a real
 * calendar. Reverting it to one-way while the rest of the pass keeps applying the
 * classifications that pair produced would destroy source events Keeper has already told
 * the user it stopped touching, so the pair is fenced off for the remainder of the pass.
 */
const createPairKey = (target: WriteBackTarget): string =>
  `${target.sourceCalendarId}|${target.destinationCalendarId}`;

type ActionableClassification = Extract<
  InboundClassification,
  { type: "delete" } | { type: "write-back" }
>;

const isActionable = (
  classification: InboundClassification,
): classification is ActionableClassification =>
  classification.type === "delete" || classification.type === "write-back";

const matchesExpectedText = (expected: string | undefined, actual: string | null): boolean =>
  typeof expected !== "string" || normalizeText(expected) === normalizeText(actual ?? "");

const matchesExpectedDate = (expected: Date | undefined, actual: Date): boolean =>
  !(expected instanceof Date) || expected.getTime() === actual.getTime();

/*
 * Every field a write-back touches is one whose projection to the destination is the
 * identity, so the value the classifier saw is byte-for-byte the value stored on the
 * source. Comparing them under the lock is what turns a fan-in race into the ordinary
 * both-sides-changed case, which the next pass resolves in favour of the source. A source
 * event carrying no title of its own is the exception: the reconcile path substitutes a
 * placeholder for it, so that placeholder is what the classifier compared against.
 */
const matchesExpectedSource = (
  expected: ExpectedSourceFields,
  snapshot: SourceEventSnapshot,
): boolean => {
  const expectedAllDay = expected.isAllDay;
  const actualAllDay = resolveIsAllDayEvent({
    endTime: snapshot.endTime,
    ...(typeof snapshot.isAllDay === "boolean" && { isAllDay: snapshot.isAllDay }),
    startTime: snapshot.startTime,
  });

  return matchesExpectedText(expected.summary, snapshot.title ?? DEFAULT_EVENT_NAME)
    && matchesExpectedText(expected.description, snapshot.description)
    && matchesExpectedText(expected.location, snapshot.location)
    && matchesExpectedDate(expected.startTime, snapshot.startTime)
    && matchesExpectedDate(expected.endTime, snapshot.endTime)
    && (typeof expectedAllDay !== "boolean" || expectedAllDay === actualAllDay);
};

/*
 * A deletion is unrecoverable, so it is authorized only by evidence that covers every field
 * the classifier would have refused on. A classification that reports less than that — one
 * produced before this guard existed, or by a pass still in flight during a deploy — is not
 * evidence the source event is untouched, and the deletion is abandoned rather than guessed.
 */
const coversEveryField = (expected: ExpectedSourceFields): boolean =>
  typeof expected.summary === "string"
  && typeof expected.description === "string"
  && typeof expected.location === "string"
  && expected.startTime instanceof Date
  && expected.endTime instanceof Date
  && typeof expected.isAllDay === "boolean";

const isStillTheStateWeClassified = async (
  locked: LockedWriteBackStore,
  classification: ActionableClassification,
  target: WriteBackTarget,
): Promise<boolean> => {
  const mapping = await locked.readMappingSyncEventHash(target.mappingId);
  if (!mapping || mapping.syncEventHash !== classification.expectedSyncEventHash) {
    return false;
  }
  if (
    classification.type === "delete"
    && !coversEveryField(classification.expectedSource)
  ) {
    return false;
  }
  const snapshot = await locked.readSourceEvent(target.eventStateId);
  if (!snapshot) {
    return false;
  }
  return matchesExpectedSource(classification.expectedSource, snapshot);
};

/*
 * A pair that no longer authorizes this write is not a failed attempt: nothing is retried,
 * no budget is spent, and the rest of the pass leaves that pair alone. Deciding otherwise
 * would let a user who has just switched two-way sync off watch the pass that was already
 * running delete their originals anyway.
 */
const isPairStillAuthorized = async (
  locked: LockedWriteBackStore,
  classification: ActionableClassification,
  target: WriteBackTarget,
): Promise<boolean> => {
  const pair = await locked.readPairWriteBack({
    destinationCalendarId: target.destinationCalendarId,
    sourceCalendarId: target.sourceCalendarId,
  });
  if (!pair || !isWriteBackMode(pair.writeBackMode)) {
    return false;
  }
  const { paused, writeBackMode } = resolveWriteBackPolicyState(
    pair.writeBackMode,
    pair.writeBackState,
  );
  if (paused || writeBackMode === "off") {
    return false;
  }
  return classification.type !== "delete" || writeBackMode === "edits_and_deletes";
};

type Outcome = "abandoned" | "applied" | "quarantined" | "withheld";

/*
 * What happened to the classification, and whether the pair stopped accepting work
 * because of it. The two are separate because a write can reach the real calendar and
 * trip a stop on the way out: the pair must pause, and the source event must still be
 * reported as changed to everything that mirrors it.
 */
interface ClassificationOutcome {
  outcome: Outcome;
  pausesPair: boolean;
}

const quarantineRunaway = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
): Promise<void> => {
  await input.store.quarantineMapping(
    target.sourceCalendarId,
    target.destinationCalendarId,
    "runaway_write_back",
  );
};

const runLockedUpdate = (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  writer: CalendarSourceWriter,
  classification: Extract<InboundClassification, { type: "write-back" }>,
): Promise<{ dailyCount: number; epoch: number; state: Outcome }> =>
  input.store.withSourceLock(
    target.sourceCalendarId,
    async (locked): Promise<{ dailyCount: number; epoch: number; state: Outcome }> => {
      if (!await isPairStillAuthorized(locked, classification, target)) {
        return { dailyCount: NO_WORK, epoch: NO_WORK, state: "withheld" };
      }
      if (!await isStillTheStateWeClassified(locked, classification, target)) {
        return { dailyCount: NO_WORK, epoch: NO_WORK, state: "abandoned" };
      }

      /*
       * The budget is spent inside the transaction that carries the local commit and
       * before the provider is called: a budget read after the call cannot prevent the
       * call, and a write that then fails rolls the reservation back with everything
       * else the transaction touched.
       */
      const committed = await locked.commitUpdate({
        eventStateId: target.eventStateId,
        mappingId: target.mappingId,
        observed: classification.observed,
        projectedSyncEventHash: classification.projectedSyncEventHash,
        updates: classification.updates,
      });
      if ((committed.writeBackDailyCount ?? NO_WORK) > TWO_WAY_WRITE_BACK_DAILY_CAP) {
        throw new WriteBackDailyCapError(target.mappingId);
      }

      const written = await writer.updateEvent(
        { sourceEventId: target.sourceEventId, sourceEventUid: target.sourceEventUid },
        classification.updates,
        input.signal,
      );
      assertWriteAccepted(written, "Source write-back failed");

      return {
        dailyCount: committed.writeBackDailyCount ?? NO_WORK,
        epoch: committed.writeBackEpoch,
        state: "applied",
      };
    },
  );

const quarantineRefusal = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  error: SourceWriteRefusedError,
): Promise<Outcome> => {
  await input.store.quarantineMapping(
    target.sourceCalendarId,
    target.destinationCalendarId,
    resolveQuarantineReason(error.refusal),
  );
  return "quarantined";
};

type UpdateOutcome =
  | { dailyCount: number; epoch: number; kind: "committed"; state: Outcome }
  | { kind: "over-budget" }
  | { kind: "refused"; refusal: SourceWriteRefusedError };

const runBudgetedUpdate = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  writer: CalendarSourceWriter,
  classification: Extract<InboundClassification, { type: "write-back" }>,
): Promise<UpdateOutcome> => {
  try {
    const { dailyCount, epoch, state } = await runLockedUpdate(
      input,
      target,
      writer,
      classification,
    );
    return { dailyCount, epoch, kind: "committed", state };
  } catch (error) {
    if (error instanceof WriteBackDailyCapError) {
      return { kind: "over-budget" };
    }
    if (error instanceof SourceWriteRefusedError) {
      return { kind: "refused", refusal: error };
    }
    throw error;
  }
};

const applyUpdate = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  writer: CalendarSourceWriter,
  classification: Extract<InboundClassification, { type: "write-back" }>,
): Promise<ClassificationOutcome> => {
  const outcome = await runBudgetedUpdate(input, target, writer, classification);
  if (outcome.kind === "refused") {
    return {
      outcome: await quarantineRefusal(input, target, outcome.refusal),
      pausesPair: true,
    };
  }
  if (outcome.kind === "over-budget") {
    await quarantineRunaway(input, target);
    return { outcome: "quarantined", pausesPair: true };
  }
  /*
   * The classifier stops handing this mapping work the moment its daily count reaches the
   * cap, so the budget has to be judged spent at the cap rather than past it. Judging it
   * past the cap leaves the pair silently frozen for the rest of the day with nothing said.
   */
  if (
    outcome.state === "applied"
    && (
      outcome.epoch >= TWO_WAY_EPOCH_QUARANTINE_LIMIT
      || outcome.dailyCount >= TWO_WAY_WRITE_BACK_DAILY_CAP
    )
  ) {
    await quarantineRunaway(input, target);
    /*
     * The write already reached the real calendar; only the stop came after it. Reporting
     * it as a quarantine alone would tell the rest of the pass that no source event
     * changed, so the other destinations mirroring that source are never woken and the
     * pass that modified a real calendar reports having written nothing.
     */
    return { outcome: "applied", pausesPair: true };
  }
  return { outcome: outcome.state, pausesPair: false };
};

/*
 * A probe that throws has not said the copy is gone; it has said it could not look. That
 * is the provider declining a read, on a path where nothing was written and no source
 * calendar was contacted, so it must not be spent as the permanent defect that turns
 * two-way sync off for the pair and hands the edited copies back to the one-way repair.
 * It is reported and answered as "cannot confirm", which pauses the pair with a question
 * for the user once the retries run out.
 */
const readPresence = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  probe: (target: WriteBackTarget) => Promise<RemoteEventPresence>,
): Promise<RemoteEventPresence | null> => {
  try {
    return await probe(target);
  } catch (error) {
    input.onError?.(error, { mappingId: target.mappingId });
    return null;
  }
};

/*
 * The mapping is missing from a list read, and a list read has no completeness
 * guarantee. Nothing on the source is destroyed until a targeted read of the copy
 * itself answers not-found: present, unreachable or unimplemented all refuse.
 */
const isAbsenceConfirmed = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
): Promise<boolean> => {
  const probe = input.store.probeDestinationEvent;
  if (!probe) {
    input.onDeleteBlocked?.({
      mappingId: target.mappingId,
      reason: "probe_unavailable",
    });
    return false;
  }

  const presence = await readPresence(input, target, probe);
  if (presence === "absent") {
    return true;
  }
  if (presence === null) {
    input.onDeleteBlocked?.({
      mappingId: target.mappingId,
      reason: "probe_unreachable",
    });
    return false;
  }
  input.onDeleteBlocked?.({ mappingId: target.mappingId, reason: "still_present" });
  return false;
};

const applyDelete = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  writer: CalendarSourceWriter,
  classification: Extract<InboundClassification, { type: "delete" }>,
  now: Date,
): Promise<Outcome> => {
  if (!await isAbsenceConfirmed(input, target)) {
    return "abandoned";
  }

  const recentDeletes = await input.store.countRecentDeletes(
    target.sourceCalendarId,
    new Date(now.getTime() - TWO_WAY_DELETE_DAILY_WINDOW_MS),
  );
  if (recentDeletes >= TWO_WAY_DELETE_DAILY_CAP) {
    await input.store.quarantineMapping(
      target.sourceCalendarId,
      target.destinationCalendarId,
      "delete_daily_cap",
    );
    return "quarantined";
  }

  /*
   * The record of what is about to be destroyed is committed on its own transaction
   * before the provider is asked to destroy it. The advisory lock below is transaction
   * scoped, so it cannot be the same transaction.
   */
  const preSnapshot = await input.store.readSourceEvent(target.eventStateId);
  if (!preSnapshot) {
    return "abandoned";
  }
  const tombstone = await input.store.recordTombstone({ snapshot: preSnapshot, target });
  const { id: tombstoneId, observedAt } = tombstone;
  const releaseTombstone = async (): Promise<void> => {
    if (tombstone.priorAttempt) {
      return;
    }
    await input.store.abandonTombstone({ observedAt, tombstoneId });
  };

  const run = input.store.withSourceLock(
    target.sourceCalendarId,
    async (locked): Promise<Outcome> => {
      if (!await isPairStillAuthorized(locked, classification, target)) {
        await releaseTombstone();
        return "withheld";
      }
      if (!await isStillTheStateWeClassified(locked, classification, target)) {
        await releaseTombstone();
        return "abandoned";
      }

      const deleted = await writer.deleteEvent(
        { sourceEventId: target.sourceEventId, sourceEventUid: target.sourceEventUid },
        input.signal,
      );
      assertWriteAccepted(deleted, "Source write-back delete failed");

      await locked.commitDelete({
        eventStateId: target.eventStateId,
        mappingId: target.mappingId,
        tombstoneId,
      });
      return "applied";
    },
  );

  /*
   * The tombstone was committed on its own transaction before the provider was asked, so
   * every answer that destroyed nothing has to release it explicitly: nothing rolls it
   * back. A tombstone left standing for a deletion the provider declined would spend one
   * of the day's slots, and enough of them would refuse the real deletions that follow —
   * telling the user their originals were being deleted in bulk when none of them were.
   * The record itself survives: an abandoned row keeps its snapshot, it is only uncounted.
   */
  return run.catch(async (error: unknown) => {
    if (error instanceof SourceWriteRefusedError) {
      await releaseTombstone();
      return quarantineRefusal(input, target, error);
    }
    if (error instanceof SourceWriteRejectedError) {
      await releaseTombstone();
    }
    throw error;
  });
};

const applyClassification = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  writer: CalendarSourceWriter,
  classification: ActionableClassification,
  now: Date,
): Promise<ClassificationOutcome> => {
  if (classification.type === "delete") {
    return {
      outcome: await applyDelete(input, target, writer, classification, now),
      pausesPair: false,
    };
  }
  return applyUpdate(input, target, writer, classification);
};

/*
 * An abandoned attempt makes no progress and leaves everything it was classified from
 * unchanged, so the very same classification is produced again on the next pass. Spending
 * the budget on it is what makes the retry finite: a write-back is refused once the budget
 * is out, and a deletion the copy keeps refusing to confirm becomes a question for the
 * user instead of a request repeated once a minute forever.
 */
const recordNonProgress = async (
  input: WriteBackPassInput,
  target: WriteBackTarget,
  classification: ActionableClassification,
): Promise<boolean> => {
  const spent = await input.store.recordFailure(target.mappingId);
  if (spent < TWO_WAY_EPOCH_QUARANTINE_LIMIT) {
    return false;
  }
  if (classification.type !== "delete") {
    /*
     * The epoch this abandon just spent is the mapping's last, and a spent epoch is sticky:
     * the classifier refuses every further write-back for that mapping and suppresses the
     * one-way repair with it, recording the destination's edited values as the new
     * baseline. Left unsaid that is one event frozen in both directions for good, so the
     * pair reverts to one-way and says so, exactly as a runaway write-back does.
     */
    await input.store.quarantineMapping(
      target.sourceCalendarId,
      target.destinationCalendarId,
      "runaway_write_back",
    );
    return true;
  }
  await input.store.requestDeleteConfirmation?.(
    target.sourceCalendarId,
    target.destinationCalendarId,
    "delete_probe_blocked",
  );
  return true;
};

const runWriteBackPass = async (
  input: WriteBackPassInput,
): Promise<WriteBackPassResult> => {
  const readNow = input.now ?? (() => new Date());
  const startedAt = readNow().getTime();
  const touchedSourceCalendarIds = new Set<string>();
  const quarantinedPairKeys = new Set<string>();
  const result: WriteBackPassResult = {
    abandoned: NO_WORK,
    applied: NO_WORK,
    failed: NO_WORK,
    quarantined: NO_WORK,
    withheld: NO_WORK,
  };
  let attempted = NO_WORK;

  for (const classification of input.classifications) {
    if (!isActionable(classification)) {
      continue;
    }
    if (attempted >= MAX_WRITE_BACKS_PER_PASS) {
      break;
    }
    if (readNow().getTime() - startedAt >= TWO_WAY_WRITE_BACK_PASS_BUDGET_MS) {
      break;
    }
    attempted += 1;
    let failedTarget: WriteBackTarget | null = null;

    try {
      /*
       * A classification nobody can act on is a failure, never a no-op. Skipping it
       * silently would take the write-back branch on every pass with nothing to apply,
       * freezing the destination's ordinary pushes for as long as the source stays
       * unusable, with no counter to show for it.
       */
      const target = await input.store.loadTarget(classification.mappingId);
      if (!target) {
        throw new UnusableSourceError(
          `Event mapping ${classification.mappingId} has no source event to write to`,
        );
      }
      if (quarantinedPairKeys.has(createPairKey(target))) {
        result.withheld += 1;
        continue;
      }
      failedTarget = target;
      const writer = await input.store.resolveWriter(target.sourceCalendarId);
      if (!writer) {
        throw new UnusableSourceError(
          `Source calendar ${target.sourceCalendarId} has no usable write credentials`,
        );
      }

      const { outcome, pausesPair } = await applyClassification(
        input,
        target,
        writer,
        classification,
        readNow(),
      );

      /*
       * One classification, one counter: the totals bound the pass against its own cap.
       * A write that landed and then tripped a stop counts as applied, because that is the
       * half of it a real calendar can see; the pause it caused is carried by pausesPair
       * and by the pair's own recorded state.
       */
      result[outcome] += 1;
      if (pausesPair || outcome === "quarantined" || outcome === "withheld") {
        quarantinedPairKeys.add(createPairKey(target));
      }
      if (outcome === "applied") {
        touchedSourceCalendarIds.add(target.sourceCalendarId);
      }
      if (outcome === "abandoned") {
        /*
         * Pausing the pair for a human answer is the same decision a quarantine is: the
         * user has been told nothing was deleted and is being asked what happened, so the
         * rest of this pass must not answer the question by destroying the originals.
         */
        const paused = await recordNonProgress(input, target, classification);
        if (paused) {
          quarantinedPairKeys.add(createPairKey(target));
        }
      }
    } catch (error) {
      result.failed += 1;
      input.onError?.(error, { mappingId: classification.mappingId });
      /*
       * The budget is spent against the mapping the classification names rather than
       * against a target, because the failure that loads no target at all is the one that
       * would otherwise repeat untouched on every pass. Only the pair a target identifies
       * can be reverted to one-way.
       */
      const spent = await input.store.recordFailure(classification.mappingId);
      if (failedTarget && spent >= resolveQuarantineLimit(error)) {
        await input.store.quarantineMapping(
          failedTarget.sourceCalendarId,
          failedTarget.destinationCalendarId,
          "write_back_failing",
        );
        quarantinedPairKeys.add(createPairKey(failedTarget));
        result.quarantined += 1;
      }
    }
  }

  for (const sourceCalendarId of touchedSourceCalendarIds) {
    await input.store.notifySiblings(sourceCalendarId, input.calendarId);
  }

  return result;
};

export { MAX_WRITE_BACKS_PER_PASS, runWriteBackPass };
export type {
  LockedWriteBackStore,
  PairWriteBackAuthority,
  SourceEventSnapshot,
  WriteBackPassResult,
  WriteBackStore,
  WriteBackTarget,
};

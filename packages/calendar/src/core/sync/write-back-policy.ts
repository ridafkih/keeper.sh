import { TWO_WAY_SOURCE_INGEST_MAX_AGE_MS } from "@keeper.sh/constants";
import { resolveWriteBackFieldNames } from "@keeper.sh/data-schemas";
import type {
  WriteBackFieldExclusions,
  WriteBackFieldName,
} from "@keeper.sh/data-schemas";

const WRITE_BACK_MODES = ["edits", "edits_and_deletes", "off"] as const;

type WriteBackMode = typeof WRITE_BACK_MODES[number];

type WriteBackState = "delete_confirmation_required" | "ok" | "quarantined";

/*
 * The set of fields two-way sync may write to a real calendar is declared once, beside the
 * labels the dashboard discloses them under, so the payload and the disclosure cannot drift.
 */
type WriteBackField = WriteBackFieldName;

interface WriteBackPolicy {
  /*
   * A human has looked at copies that vanished in bulk and said to go ahead. It speaks
   * only for the disappearances already on record when the answer was given: each one is
   * still confirmed against the copy itself, still capped per day, still tombstoned first.
   */
  deleteApproved: boolean;
  /*
   * The instant the answer was given. A disappearance first observed after it is one no
   * human has been shown, so the approval does not speak for it.
   */
  deleteApprovedAt?: Date | null;
  destinationCalendarId: string;
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
  /*
   * A pair waiting on a human answer about copies that vanished keeps its mode, so the
   * classifier still recognises the mappings the question is about. It acts on none of
   * them and holds their pending state, rather than letting the copies be re-created out
   * from under the question it just asked.
   */
  paused: boolean;
  sourceCalendarId: string;
  writeBackMode: WriteBackMode;
}

const NO_WRITE_BACKS = 0;

/*
 * A recorded observation belongs to the policy it was taken under, and so do the budgets
 * spent under it. Dropping the observation without returning the budgets would leave a
 * once-runaway mapping permanently refused after a human clears the quarantine.
 */
const WRITE_BACK_WITNESS_RESET = {
  destinationAvailability: null,
  destinationContentHash: null,
  destinationDescription: null,
  destinationEndTime: null,
  destinationIsAllDay: null,
  destinationLocation: null,
  destinationStartTime: null,
  destinationSummary: null,
  writeBackDailyCount: NO_WRITE_BACKS,
  writeBackDailyWindowStart: null,
  writeBackEpoch: NO_WRITE_BACKS,
  writeBackEpochWindowStart: null,
  writeBackLastAppliedAt: null,
} as const;

interface WriteBackUpdates {
  description?: string;
  endTime?: Date;
  isAllDay?: boolean;
  location?: string;
  startTime?: Date;
  startTimeZone?: string;
  summary?: string;
}

const isWriteBackMode = (value: string): value is WriteBackMode =>
  WRITE_BACK_MODES.includes(value as WriteBackMode);

const DELETE_CONFIRMATION_STATE = "delete_confirmation_required";

/*
 * Everything two-way sync knows about a source event is the copy the last ingest stored.
 * Every guard that refuses to overwrite or delete an original because it moved — the drift
 * comparison in the classifier, the expected-source check taken under the source lock, the
 * field coverage a deletion is authorised by — reads that same stored copy, so once it
 * stops being refreshed they all agree with themselves and authorise a write against a
 * calendar nobody has looked at for hours. An unknown age reads as too old: a source that
 * has never recorded a successful read is exactly the one whose stored copy cannot be
 * trusted.
 */
const isSourceSnapshotFresh = (
  source: { ingestLastSucceededAt?: Date | null } | null,
  now: Date,
): boolean => {
  const succeededAt = source?.ingestLastSucceededAt;
  if (!(succeededAt instanceof Date) || !Number.isFinite(succeededAt.getTime())) {
    return false;
  }
  return now.getTime() - succeededAt.getTime() <= TWO_WAY_SOURCE_INGEST_MAX_AGE_MS;
};

/*
 * A quarantined pair reverts to one-way outright. A pair waiting on a human answer about
 * copies that vanished keeps its mode and pauses instead: dropping it would let the very
 * copies the question is about be re-created on the next pass, destroying the pending
 * state the answer is supposed to resolve.
 */
const resolveWriteBackPolicyState = (
  writeBackMode: WriteBackMode,
  writeBackState: string,
  deleteApproval?: { approvedAt: Date | null; now: Date; ttlMs: number },
): {
  deleteApproved: boolean;
  deleteApprovedAt: Date | null;
  paused: boolean;
  writeBackMode: WriteBackMode;
} => {
  const approvedAt = deleteApproval?.approvedAt ?? null;
  const deleteApproved = deleteApproval?.approvedAt instanceof Date
    && deleteApproval.now.getTime() - deleteApproval.approvedAt.getTime()
      < deleteApproval.ttlMs;

  if (writeBackState === DELETE_CONFIRMATION_STATE) {
    return {
      deleteApproved: false,
      deleteApprovedAt: null,
      paused: true,
      writeBackMode,
    };
  }
  if (writeBackState !== "ok") {
    return {
      deleteApproved: false,
      deleteApprovedAt: null,
      paused: false,
      writeBackMode: "off",
    };
  }
  if (!deleteApproved) {
    return {
      deleteApproved: false,
      deleteApprovedAt: null,
      paused: false,
      writeBackMode,
    };
  }
  return {
    deleteApproved: true,
    deleteApprovedAt: approvedAt,
    paused: false,
    writeBackMode,
  };
};

const resolveWriteBackEligibleFields = (
  policy?: WriteBackPolicy,
): Set<WriteBackField> => {
  if (!policy) {
    throw new Error("Write-back eligibility requires a source calendar policy");
  }
  return resolveWriteBackFieldNames(policy);
};

const SCHEDULE_FIELDS: WriteBackField[] = ["endTime", "isAllDay", "startTime"];

const assertWriteBackPayload = (
  updates: WriteBackUpdates,
  eligibleFields: ReadonlySet<WriteBackField>,
): void => {
  for (const field of Object.keys(updates)) {
    if (!eligibleFields.has(field as WriteBackField)) {
      throw new Error(`Write-back payload carries the redacted field ${field}`);
    }
  }

  const present = SCHEDULE_FIELDS.filter((field) => field in updates);
  if (present.length > 0 && present.length !== SCHEDULE_FIELDS.length) {
    throw new Error(
      "Write-back payload carries a partial schedule; start, end and all-day travel together",
    );
  }
};

export {
  assertWriteBackPayload,
  isSourceSnapshotFresh,
  isWriteBackMode,
  resolveWriteBackEligibleFields,
  resolveWriteBackPolicyState,
  WRITE_BACK_MODES,
  WRITE_BACK_WITNESS_RESET,
};
export type {
  WriteBackField,
  WriteBackFieldExclusions,
  WriteBackMode,
  WriteBackPolicy,
  WriteBackState,
  WriteBackUpdates,
};

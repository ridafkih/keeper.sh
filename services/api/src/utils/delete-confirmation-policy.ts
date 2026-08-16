const DELETE_PROBE_BLOCKED_REASON = "delete_probe_blocked";
const DELETE_CONFIRMATION_STATE = "delete_confirmation_required";

const DELETE_CONFIRMATION_NOT_APPLICABLE_MESSAGE =
  "The copies are still on the destination calendar, so the originals cannot be deleted";

const BLANK_READ_NOT_APPLICABLE_MESSAGE =
  "The last reading of the destination calendar came back empty, which cannot tell deleted"
  + " copies from a broken connection, so the originals cannot be deleted yet";

const NO_DELETE_CONFIRMATION_PENDING_MESSAGE =
  "Keeper.sh is not waiting on an answer about deleted copies for this pair";

/*
 * Approving deletions is an answer to one question: whether copies Keeper.sh can no longer
 * see were really removed. A pair paused because the per-event probe keeps finding the
 * copies present is not asking that. Approving there deletes originals whose copies exist,
 * and the approval also exempts the pair from the bulk-delete breaker for half an hour, so
 * it is refused rather than recorded.
 */
const isDeleteApprovalApplicable = (pauseReason: string | null): boolean =>
  pauseReason !== DELETE_PROBE_BLOCKED_REASON;

const COPIES_MISSING_REASON = "all_copies_missing";

/*
 * The dashboard withholding the button is not a gate: a stale client, a second tab and a
 * curl all reach here. A read that returned nothing at all cannot tell an emptied
 * destination from a broken connection — a wrong calendar id, a revoked grant, a provider
 * outage — and this approval both releases the hold on that read and exempts the pair from
 * the bulk-delete breaker for half an hour. It is refused until a read has come back with
 * at least one copy since the copies went missing.
 */
const isBlockedByBlankRead = (
  pending: { deletesUnlocked: boolean; writeBackStateReason: string | null },
): boolean =>
  pending.writeBackStateReason === COPIES_MISSING_REASON && !pending.deletesUnlocked;

/*
 * The way out for a destination calendar that holds nothing but Keeper.sh's copies. Putting
 * the copies back and deleting them again cannot work there: the second removal is another
 * reading that comes back with nothing at all, so it re-arms the same hold, and the loop
 * has no end. Nothing Keeper.sh can observe separates that calendar from an unreachable
 * one, so the user states it — as its own answer, in its own words, never as the plain
 * "Delete the originals" button offered on evidence that does not exist.
 *
 * It is refused while the destination's connection is one Keeper.sh already knows is
 * broken. That is the other cause of an empty reading, and where it is on record the
 * assertion is being made about a calendar nobody has actually looked at.
 */
const EMPTY_DESTINATION_DECISION = "apply_empty_destination";

const EMPTY_DESTINATION_NOT_APPLICABLE_MESSAGE =
  "Keeper.sh is not holding this pair on a reading of the destination calendar that came"
  + " back empty, so there is nothing to say the destination is empty about";

const DISCONNECTED_DESTINATION_MESSAGE =
  "The destination calendar's connection is broken, which is the other thing an empty"
  + " reading means, so the originals cannot be deleted on that answer. Reconnect it first";

const describeNotApplicable = (
  pending: {
    decision: string;
    deletesUnlocked: boolean;
    destinationReachable: boolean;
    writeBackStateReason: string | null;
  },
): string => {
  if (pending.decision === EMPTY_DESTINATION_DECISION) {
    if (!pending.destinationReachable) {
      return DISCONNECTED_DESTINATION_MESSAGE;
    }
    return EMPTY_DESTINATION_NOT_APPLICABLE_MESSAGE;
  }
  if (isBlockedByBlankRead(pending)) {
    return BLANK_READ_NOT_APPLICABLE_MESSAGE;
  }
  return DELETE_CONFIRMATION_NOT_APPLICABLE_MESSAGE;
};

type ConfirmationDisposition =
  | "approve"
  | "decline"
  | "ignore"
  | "not_applicable"
  | "not_pending";

/*
 * A pair that is not asking has no answer to record. Stamping the approval anyway arms a
 * half-hour exemption from the bulk-delete breaker and from the hold on an ambiguous empty
 * read, so a stray click — a double submit, a second tab, a client retry — leaves real
 * source events unprotected against the next truncated listing. Clearing the state anyway
 * is just as wrong in the other direction: a quarantine is a safety stop, not a question,
 * and lifting it resumes writing to a real calendar the pass had decided it could not
 * trust. Neither decision touches a pair that is not waiting on one.
 */
const resolveConfirmationDisposition = (
  decision: string,
  pending: {
    deletesUnlocked: boolean;
    destinationReachable: boolean;
    writeBackState: string;
    writeBackStateReason: string | null;
  },
): ConfirmationDisposition => {
  const claimingEmpty = decision === EMPTY_DESTINATION_DECISION;
  const approving = decision === "apply" || claimingEmpty;
  if (pending.writeBackState !== DELETE_CONFIRMATION_STATE) {
    if (approving) {
      return "not_pending";
    }
    return "ignore";
  }
  if (!approving) {
    return "decline";
  }
  if (!isDeleteApprovalApplicable(pending.writeBackStateReason)) {
    return "not_applicable";
  }
  if (claimingEmpty) {
    if (pending.writeBackStateReason !== COPIES_MISSING_REASON) {
      return "not_applicable";
    }
    if (!pending.destinationReachable) {
      return "not_applicable";
    }
    return "approve";
  }
  if (isBlockedByBlankRead(pending)) {
    return "not_applicable";
  }
  return "approve";
};

export {
  BLANK_READ_NOT_APPLICABLE_MESSAGE,
  COPIES_MISSING_REASON,
  DELETE_CONFIRMATION_NOT_APPLICABLE_MESSAGE,
  DELETE_CONFIRMATION_STATE,
  DELETE_PROBE_BLOCKED_REASON,
  describeNotApplicable,
  DISCONNECTED_DESTINATION_MESSAGE,
  EMPTY_DESTINATION_DECISION,
  EMPTY_DESTINATION_NOT_APPLICABLE_MESSAGE,
  isDeleteApprovalApplicable,
  NO_DELETE_CONFIRMATION_PENDING_MESSAGE,
  resolveConfirmationDisposition,
};
export type { ConfirmationDisposition };

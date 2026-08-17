import type { WriteBackMode, WriteBackStatus } from "@/state/destination-ids";

type DeleteConfirmationAnswer = "apply" | "apply_empty_destination" | "decline";

const GRANT_REQUIRED_STATE = "grant_required";

/*
 * A held meeting is the one pause whose answer is purely a permission. The status line
 * points at the level control rather than carrying its own button, so there is one place
 * the permission is set and the held case cannot drift from the ordinary one.
 */
const isHeldForPermission = (status: WriteBackStatus | null): boolean =>
  status?.state === GRANT_REQUIRED_STATE;

const DELETE_CONFIRMATION_STATE = "delete_confirmation_required";

/*
 * "Delete the originals" is an answer to one question only: whether copies Keeper.sh can no
 * longer see were really removed by the user. A pair paused because the destination keeps
 * reporting the copies as present is not asking that question — approving there would delete
 * originals whose copies exist, and the approval doubles as a half-hour exemption from the
 * bulk-delete breaker. That answer is not offered.
 */
const PROBE_BLOCKED_REASON = "delete_probe_blocked";

/*
 * The other two pauses a held deletion can raise, and neither of them ever saw the copies
 * gone: one is Keeper.sh failing to read the destination at all, the other is the original
 * changing on the source before the deletion could be applied to it. "Delete the originals"
 * would be an answer to evidence nobody gathered, so the same withholding applies.
 */
const UNVERIFIED_DELETE_REASONS = new Set([
  PROBE_BLOCKED_REASON,
  "delete_probe_unreachable",
  "delete_source_changed",
]);

/*
 * A read that returned nothing at all has two causes and Keeper.sh cannot tell them apart:
 * the copies were deleted, or the connection, the calendar id or the provider is broken.
 * "Delete the originals" answers only the first and authorises irreversible deletions on a
 * real calendar, so it is not offered while a blank read is the only evidence. What clears
 * the bar is a read that came back with at least one copy since they went missing, which
 * the server decides and reports here. A breaker trip is deliberately not gated: it is
 * observed against a read that returned items.
 *
 * A destination calendar that holds nothing but the copies can never clear that bar on its
 * own, so it is offered the one answer that does not rest on a reading: the user's own
 * word that they emptied it. It is a separate answer with its own words, not the plain
 * "Delete the originals" button wearing a different label, because it asserts something
 * Keeper.sh could not see for itself.
 */
const COPIES_MISSING_REASON = "all_copies_missing";

const resolveDeleteConfirmationAnswers = (
  status: WriteBackStatus | null,
): DeleteConfirmationAnswer[] => {
  if (!status || status.state !== DELETE_CONFIRMATION_STATE) {
    return [];
  }
  if (UNVERIFIED_DELETE_REASONS.has(status.reason ?? "")) {
    return ["decline"];
  }
  if (status.reason === COPIES_MISSING_REASON && !status.deletesUnlocked) {
    return ["decline", "apply_empty_destination"];
  }
  return ["apply", "decline"];
};

const QUARANTINED_STATE = "quarantined";

type ModeSelection = "commit" | "confirm_deletions" | "ignore";

/*
 * A quarantined pair keeps the mode it was paused on, so the control renders that mode as
 * selected and an early return on "same mode" leaves the user pressing the only affordance
 * they have with nothing happening. Re-picking it is how a pause is answered. A pair
 * holding a question about copies that vanished is answered through the confirmation
 * instead: committing the mode there would clear the state the answer applies to without
 * the question ever being asked.
 */
const resolveModeSelection = (input: {
  locked: boolean;
  nextMode: WriteBackMode;
  selectedMode: WriteBackMode;
  status: WriteBackStatus | null;
  writableSource: boolean;
}): ModeSelection => {
  if ((input.locked || !input.writableSource) && input.nextMode !== "off") {
    return "ignore";
  }
  const restartable = input.status?.state === QUARANTINED_STATE;
  /*
   * The selection rendered here is the mode the write-back pass would act on, not the mode
   * the pair stores: a source that lost write access or one the user paused reports as off
   * while still storing a two-way mode. Turning it off is the only opt-out there is, so it
   * always reaches the server — a redundant write of "off" costs nothing, and swallowing
   * the press leaves the stored mode to come back with the access.
   */
  if (input.nextMode === input.selectedMode && !restartable && input.nextMode !== "off") {
    return "ignore";
  }
  if (input.nextMode === "edits_and_deletes") {
    return "confirm_deletions";
  }
  return "commit";
};

export {
  GRANT_REQUIRED_STATE,
  PROBE_BLOCKED_REASON,
  resolveDeleteConfirmationAnswers,
  resolveModeSelection,
  isHeldForPermission,
};
export type { DeleteConfirmationAnswer, ModeSelection };

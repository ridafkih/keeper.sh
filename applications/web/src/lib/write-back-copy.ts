import { resolveWritableWriteBackMode } from "@keeper.sh/data-schemas";

/*
 * A calendar added by link is a read-only subscription, and one shared with the user
 * read-only carries "pull" alone: Keeper.sh can copy events out of either and has nowhere
 * to write them back to. The API refuses two-way on both against the same rule, so the
 * dashboard refuses them in the same terms rather than offering a control whose only
 * effect is a rejected request and a button that springs back.
 */
const supportsWriteBack = (
  source: {
    calendarType: string;
    capabilities: readonly string[];
    paused?: boolean;
    writeBackIdentity?: string | null;
  } | null,
): boolean => {
  if (!source) {
    return false;
  }
  return resolveWritableWriteBackMode("edits", {
    calendarType: source.calendarType,
    capabilities: source.capabilities,
    disabled: source.paused ?? false,
  }) !== "off";
};

const UNWRITABLE_SOURCE_COPY =
  "This calendar is one you subscribed to by link, so Keeper.sh can only read it."
  + " Two-way sync needs a calendar it can write to.";

const READ_ONLY_SOURCE_COPY =
  "This calendar is shared with you without permission to change it, so Keeper.sh can"
  + " only read it. Two-way sync needs a calendar it can write to.";

const LINK_SOURCE_CALENDAR_TYPE = "ical";

/*
 * Nothing is read from a paused calendar, so the stored copy two-way sync would weigh a
 * change against stops being refreshed the moment it is paused. The mode is withheld
 * until it is resumed, and it is the one reason on this list the user can undo themselves.
 */
const PAUSED_SOURCE_COPY =
  "This calendar is paused, so Keeper.sh is not reading it. Two-way sync needs an"
  + " up-to-date copy of it before it will change anything on it, so it is not offered"
  + " while the calendar is paused. Resume the calendar to turn it on.";

/*
 * The three ways a source can be unwritable read differently to the person holding it: a
 * calendar they paused, a subscription they added, and a calendar someone else owns.
 * Naming the wrong one sends them looking for a setting that is not theirs to change.
 */
const resolveUnwritableSourceCopy = (
  source: {
    calendarType: string;
    capabilities: readonly string[];
    paused?: boolean;
    writeBackIdentity?: string | null;
  } | null,
): string => {
  if (source?.paused) {
    return PAUSED_SOURCE_COPY;
  }
  if (source?.calendarType === LINK_SOURCE_CALENDAR_TYPE) {
    return UNWRITABLE_SOURCE_COPY;
  }
  return READ_ONLY_SOURCE_COPY;
};

/*
 * A pair waiting on an answer about copies that vanished keeps its mode, so the control
 * goes on showing two-way as selected. It writes nothing back in the meantime and holds
 * every copy exactly where it is, for the whole connection and not only for the events the
 * question is about. Naming only the copies that vanished would leave the user editing the
 * rest in the belief those edits reach the original.
 */
const HELD_WHILE_WAITING =
  " Until you answer, two-way sync to {destination} is paused: changes you make to copies"
  + " are not written back to {source}, and the copies are left as they are.";

/*
 * A reading that came back with nothing at all has two causes and Keeper.sh cannot tell
 * them apart: the copies were deleted, or the connection to the destination is broken.
 * Stating only the first tells the user their copies are gone and then asks them to
 * authorise deleting real events on that footing, so both are named.
 */
const WRITE_BACK_STATE_COPY: Record<string, string> = {
  /*
   * The one hold that needs no answer and undoes itself. Everything two-way sync knows
   * about an original is the copy the last reading of the source stored, so a reading that
   * has fallen behind is one it will not write against. Unlike every other pause on this
   * list the copies are not rebuilt either — they are left exactly as the user left them —
   * so the sentence the others carry would be a false promise here.
   */
  source_not_read_recently:
    "Two-way sync to {destination} is paused: Keeper.sh has not been able to read {source}"
    + " recently, and it will not change an original it does not have an up-to-date copy"
    + " of. Changes you make to copies are not written back in the meantime, and the copies"
    + " are left as they are. It starts again on its own once {source} is read.",
  all_copies_missing:
    "A reading of {destination} came back with nothing on it at all. That is what"
    + " deleting every copy looks like, and it is also what a broken connection to"
    + " {destination} looks like — a sign-in that no longer works, a calendar that is no"
    + " longer there, or the provider answering with nothing — and Keeper.sh cannot tell"
    + " the two apart. It has not deleted the originals on {source} and is waiting for you"
    + " to say what happened."
    + HELD_WHILE_WAITING,
  delete_breaker_tripped:
    "A large number of copies on {destination} disappeared at once, so Keeper.sh did not"
    + " delete the originals on {source} and is waiting for you to say what happened."
    + HELD_WHILE_WAITING,
  delete_probe_blocked:
    "Keeper.sh was asked to delete originals on {source}, but it can still see the copies"
    + " on {destination}. Nothing was deleted and Keeper.sh is waiting for you to say what"
    + " happened."
    + HELD_WHILE_WAITING,
  /*
   * The copies went missing and every attempt to check {destination} for them failed, so
   * Keeper.sh has not seen the copies and has not seen them gone either. Saying it can
   * still see them — which this pause used to say — sends the user to look at a calendar
   * where nothing is wrong, and offers the wrong reading of what went wrong with it.
   */
  delete_probe_unreachable:
    "Keeper.sh was asked to delete originals on {source}, but it could not read"
    + " {destination} to check whether the copies were really removed, so it has not seen"
    + " them there and has not seen them gone either. Nothing was deleted. Check that"
    + " {destination} is still connected, then say what happened."
    + HELD_WHILE_WAITING,
  /*
   * The deletion described an original that has since changed on {source}, so it no longer
   * describes anything Keeper.sh can act on. Nothing on either calendar is wrong, and the
   * destination is not where the user should be looking.
   */
  delete_source_changed:
    "Keeper.sh was asked to delete originals on {source}, but they changed on {source}"
    + " before it could act, so the deletion no longer matched what it had been asked to"
    + " delete. Nothing was deleted and nothing on {destination} is wrong."
    + HELD_WHILE_WAITING,
  delete_daily_cap:
    "Two-way sync to {destination} is paused: more originals on {source} were being"
    + " deleted in a day than Keeper.sh will apply unattended. The copies go back to"
    + " matching {source}.",
  bulk_edit_breaker:
    "Copies on {destination} changed all at once, which reads as something moving the whole"
    + " calendar rather than as edits you made. Keeper.sh did not rewrite the originals on"
    + " {source} and paused two-way sync; the copies go back to matching {source}.",
  /*
   * The only pause whose cause ends without the user: restorePlanQuarantinedPairs
   * (packages/sync/src/sync-user.ts) clears it on the next pass once the plan covers
   * two-way sync again, and the two-way controls are disabled until then. Saying the mode
   * has to be picked again would be both an instruction that cannot be followed and a
   * promise that deleting a copy is safe, right up to the pass that makes it permanent.
   */
  plan_downgraded: "Two-way sync to {destination} is paused because the plan changed, so"
    + " the copies go back to matching {source}. It starts again on its own once the plan"
    + " covers two-way sync; to keep it off, pick One-way.",
  source_event_rich_body:
    "A copy on {destination} was changed, but the original on {source} has a formatted description — links, styling, or a meeting join block. Keeper.sh only ever reads it as plain text, so writing the change back would flatten it. Nothing on {source} was touched and two-way sync to {destination} is paused. The change on the copy is not kept: the copies go back to matching {source}.",
  source_event_authored_by_someone_else:
    "A copy on {destination} was changed, but the original on {source} was created by"
    + " somebody else. Keeper.sh will not change or delete another person's event on their"
    + " behalf, so two-way sync to {destination} is paused and nothing on {source} was"
    + " touched. The change on the copy is not kept: the copies go back to matching"
    + " {source}.",
  /*
   * The one hold on this list the user can lift, so it reads as a question rather than a
   * stoppage. Everything else on the pair is still syncing, which is why it does not say
   * two-way is paused: it is not.
   */
  shared_event:
    "A copy on {destination} was changed, but the original on {source} is a meeting other"
    + " people are invited to. Moving it emails everyone on it and cancelling it calls the"
    + " meeting off for them, so Keeper.sh held that one event and left the rest of"
    + " {destination} syncing. Nothing on {source} was touched. Allow Keeper.sh to write to"
    + " meetings you organise and it will apply the change; events somebody else created are"
    + " never included.",
  source_write_refused:
    "A copy on {destination} was changed, but {source} refused the change to the original."
    + " Nothing on {source} was touched and two-way sync to {destination} is paused. The"
    + " change on the copy is not kept: the copies go back to matching {source}.",
  /*
   * The same pause is reached two ways: a destination rewriting a copy on every pass, and
   * a person nudging the same meeting a few times in a row. Copy that only describes the
   * first sends the second user looking at their destination calendar for a fault that is
   * not there, so both are named and the one they can act on is named first.
   */
  runaway_write_back:
    "Two-way sync to {destination} is paused: the same copy was written back over and over"
    + " — because it was edited repeatedly, or because {destination} kept rewriting it — so"
    + " Keeper.sh stopped writing to {source}. The copies go back to matching {source}."
    + " Pick Two-way again to switch it back on.",
  write_back_failing:
    "Keeper.sh could not write recent changes back to {source}, so two-way sync to"
    + " {destination} is paused. The changes made on the copies are not kept: the copies go"
    + " back to matching {source}.",
};

/*
 * Why the deletion is not among the answers. Without it the user is left with one button
 * and no account of where the other went, which reads as a fault rather than as the
 * product declining to act on a reading it cannot trust.
 *
 * A destination that holds nothing but the copies cannot clear that bar by emptying itself
 * again — the next reading comes back with nothing at all too — so the way through it is
 * the user saying so, and it is named here rather than left to be discovered.
 */
const BLANK_READ_LOCKED_COPY =
  " Deleting the originals is not offered until a reading of {destination} comes back with"
  + " at least one copy on it. Check that {destination} is still connected and still the"
  + " calendar you picked. If it is connected and you emptied it yourself, say so and the"
  + " originals on {source} are deleted on your word.";

const resolveWriteBackStateCopy = (
  status: { deletesUnlocked?: boolean; reason: string | null },
  fallback: string,
): string => {
  const stated = (status.reason && WRITE_BACK_STATE_COPY[status.reason]) ?? fallback;
  if (status.reason === "all_copies_missing" && !status.deletesUnlocked) {
    return stated + BLANK_READ_LOCKED_COPY;
  }
  return stated;
};

export {
  READ_ONLY_SOURCE_COPY,
  resolveUnwritableSourceCopy,
  resolveWriteBackStateCopy,
  supportsWriteBack,
  UNWRITABLE_SOURCE_COPY,
  WRITE_BACK_STATE_COPY,
};

import {
  TWO_WAY_EDIT_ABSOLUTE_CEILING,
  TWO_WAY_WRITE_BACK_DAILY_CAP,
} from "@keeper.sh/constants";
import { describeWriteBackFields } from "@keeper.sh/data-schemas";
import type { WriteBackFieldExclusions } from "@keeper.sh/data-schemas";

const SINGLE_FIELD = 1;
const NO_FIELDS = 0;
const LAST_INDEX = -1;

const formatFieldList = (fields: string[]): string => {
  const [last] = fields.slice(LAST_INDEX);
  if (typeof last !== "string" || fields.length === SINGLE_FIELD) {
    return fields.join("");
  }
  return `${fields.slice(NO_FIELDS, LAST_INDEX).join(", ")} and ${last}`;
};

const resolveHiddenFields = (exclusions: WriteBackFieldExclusions): string[] => {
  const hidden: string[] = [];
  if (exclusions.excludeEventName) {
    hidden.push("title");
  }
  if (exclusions.excludeEventDescription) {
    hidden.push("description");
  }
  if (exclusions.excludeEventLocation) {
    hidden.push("location");
  }
  return hidden;
};

const resolveHiddenSentence = (hidden: string[]): string | null => {
  if (hidden.length === NO_FIELDS) {
    return null;
  }
  return `Their ${formatFieldList(hidden)} is hidden on copies, so it is never written back.`;
};

/*
 * The written list is derived from the same function the payload is built from, so a field
 * the pass can write to a real calendar can never be one this sentence leaves out. Naming
 * the hidden fields beside it is what stops the two halves reading as the same list.
 */
/*
 * An edit to a copy Keeper.sh has not yet observed is adopted as the baseline rather than
 * carried anywhere: it is not written back to the original and it is not undone on the
 * copy, so the two calendars simply stay different. Describing that as a replacement would
 * warn about the one outcome that does not happen and hide the one that does.
 */
const resolveAdoptedSentence = (sourceName: string): string =>
  "An edit made to a copy Keeper.sh has not observed yet — just after two-way sync is"
  + " switched on, or in the first minute after Keeper.sh updates that copy — stays on the"
  + ` copy and is not written back to ${sourceName}. The two stay different until the`
  + " original changes again.";

/*
 * Both sides moving since the last push resolves source-wins: the copy is rebuilt from the
 * original and the edit made on the copy is gone. Saying which side wins is the only way a
 * user can tell that outcome apart from the edit having been written back.
 */
const resolveConflictSentence = (sourceName: string): string =>
  `If the original also changed since Keeper.sh last updated the copy, ${sourceName} wins:`
  + " the copy is rebuilt from the original and the edit made on the copy is replaced.";

/*
 * A pass that sees more edited copies than the ceiling writes none of them back and
 * rebuilds all of them: the batch reads as something moving the whole calendar rather than
 * as edits a person made. The count is taken over the receiving calendar, across every
 * calendar copied into it, because a batch spread thinly across several sources is exactly
 * the shape the ceiling exists to catch. Stating it as a per-calendar rule would hand the
 * user a number twice the one the classifier holds at whenever two calendars share a
 * receiving calendar — the ordinary shape of this product — and they would learn the real
 * one afterwards, from a status line, with the edits already gone.
 */
const resolveBatchSentence = (sourceName: string): string =>
  `Editing more than ${TWO_WAY_EDIT_ABSOLUTE_CEILING} copies before Keeper.sh next checks`
  + " — counted across every calendar copied into the same receiving calendar, not just"
  + " this one — reads as something moving the whole calendar rather than as edits you"
  + ` made: none of those edits reach ${sourceName}, those copies are rebuilt from it, and`
  + " two-way sync pauses on every calendar in that batch until you switch it on again.";

/*
 * The other half of the same defence, and the half a person is far more likely to walk
 * into: a run of write-backs to one event reads as a destination generating changes by
 * itself, so nudging one meeting five times in close succession — or twenty times across
 * a day — pauses the whole connection and rebuilds every copy on it from the original.
 * Stated in the terms the user acts in, a count of edits to one copy, rather than in the
 * counter's terms.
 */
const resolveRepeatedSentence = (sourceName: string): string =>
  `Editing the same copy over and over — several times within a few minutes, or more than`
  + ` ${TWO_WAY_WRITE_BACK_DAILY_CAP} times in a day — reads as that copy changing by`
  + " itself rather than as edits you made. Two-way sync pauses until you switch it on"
  + ` again, and the copies on the connection are rebuilt from ${sourceName}, so any edit`
  + " that had not reached it yet is replaced.";

const buildWriteBackFieldSummary = (
  exclusions: WriteBackFieldExclusions,
  sourceName: string,
): {
  adopted: string;
  batch: string;
  conflict: string;
  hidden: string | null;
  repeated: string;
  written: string;
} => ({
  adopted: resolveAdoptedSentence(sourceName),
  batch: resolveBatchSentence(sourceName),
  conflict: resolveConflictSentence(sourceName),
  repeated: resolveRepeatedSentence(sourceName),
  hidden: resolveHiddenSentence(resolveHiddenFields(exclusions)),
  written: `Editing a copy changes the original event on ${sourceName}: its `
    + `${formatFieldList(describeWriteBackFields(exclusions))}.`,
});

export { buildWriteBackFieldSummary, formatFieldList };

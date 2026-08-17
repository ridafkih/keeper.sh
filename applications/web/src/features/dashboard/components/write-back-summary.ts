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
 *
 * The conflict, adopt-window, batch and repeat-cap rules used to be restated here and are
 * now only on /docs/two-way-sync, which the settings page links to: one wording to keep
 * true rather than two that can drift apart.
 */
const buildWriteBackFieldSummary = (
  exclusions: WriteBackFieldExclusions,
  sourceName: string,
): {
  hidden: string | null;
  written: string;
} => ({
  hidden: resolveHiddenSentence(resolveHiddenFields(exclusions)),
  written: `Editing a copy changes the original event on ${sourceName}: its `
    + `${formatFieldList(describeWriteBackFields(exclusions))}.`,
});

export { buildWriteBackFieldSummary, formatFieldList };

import type { EditableContent, Instant } from "@keeper.sh/sync-protocol";
import { IcsInternalDataError } from "../errors";
import type { ParsedVevent } from "../parse/parse-vevent";
import type { CanonicalEvent } from "./canonical-event";

const utcExceptionValue = /^\d{8}T\d{6}Z$/u;

const exceptionInstant = (value: string): Instant => {
  if (!utcExceptionValue.test(value)) {
    throw new IcsInternalDataError(`a canonical exception date is not a UTC instant: ${value}`);
  }
  return {
    kind: "instant",
    value: new Date(
      Date.UTC(
        Number(value.slice(0, 4)),
        Number(value.slice(4, 6)) - 1,
        Number(value.slice(6, 8)),
        Number(value.slice(9, 11)),
        Number(value.slice(11, 13)),
        Number(value.slice(13, 15)),
      ),
    ).toISOString(),
  };
};

const cancellationsOf = (content: EditableContent): readonly Instant[] => {
  if (!content.recurrence) {
    return [];
  }
  return content.recurrence.exceptions.map((value) => exceptionInstant(value));
};

const projectCanonicalEvent = (event: ParsedVevent): CanonicalEvent => ({
  identity: event.identity,
  content: event.content,
  cancellations: cancellationsOf(event.content),
});

export { projectCanonicalEvent };

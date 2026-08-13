import {
  CalDAVIncompleteMultiGetError,
  CalDAVUnreadableResourceError,
} from "@keeper.sh/calendar/caldav";
import { classifyDatabaseError } from "@keeper.sh/database";

interface MissingCalendarFailure {
  disableCalendar: false;
  retriable: true;
  slug: "provider-calendar-not-found";
}

const hasNotFoundStatus = (error: Error): boolean =>
  "status" in error && error.status === 404;

const resolveMissingCalendarFailure = (error: unknown): MissingCalendarFailure | null => {
  if (
    error instanceof CalDAVIncompleteMultiGetError
    || error instanceof CalDAVUnreadableResourceError
  ) {
    return null;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  const mentionsNotFound = error.message.includes("404")
    && classifyDatabaseError(error) === null;

  if (!hasNotFoundStatus(error) && !mentionsNotFound) {
    return null;
  }

  return {
    disableCalendar: false,
    retriable: true,
    slug: "provider-calendar-not-found",
  };
};

export { resolveMissingCalendarFailure };
export type { MissingCalendarFailure };

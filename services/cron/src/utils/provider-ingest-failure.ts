import { isTimeoutError } from "@keeper.sh/calendar";
import {
  CalDAVIncompleteMultiGetError,
  CalDAVUnreadableResourceError,
  isCalDAVAuthenticationError,
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

  if (!(error instanceof Error) || (!hasNotFoundStatus(error) && !error.message.includes("404"))) {
    return null;
  }

  return {
    disableCalendar: false,
    retriable: true,
    slug: "provider-calendar-not-found",
  };
};

const hasOwnSlug = (error: unknown): boolean =>
  error instanceof CalDAVIncompleteMultiGetError
  || error instanceof CalDAVUnreadableResourceError;

const shouldTreatAsProviderAuthFailure = (error: unknown): boolean => {
  if (isTimeoutError(error) || hasOwnSlug(error) || classifyDatabaseError(error)) {
    return false;
  }
  return isCalDAVAuthenticationError(error);
};

export { resolveMissingCalendarFailure, shouldTreatAsProviderAuthFailure };
export type { MissingCalendarFailure };

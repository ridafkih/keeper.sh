import { isTimeoutError } from "@keeper.sh/calendar";
import {
  CalDAVIncompleteMultiGetError,
  CalDAVUnreadableResourceError,
  isCalDAVAuthenticationError,
} from "@keeper.sh/calendar/caldav";
import { isDatabaseError } from "@keeper.sh/database";
import { requiresReauthentication } from "@/utils/error-flags";

interface MissingCalendarFailure {
  disableCalendar: false;
  retriable: true;
  slug: "provider-calendar-not-found";
}

const NOT_FOUND_STATUS = 404;

const missingCalendarFailure: MissingCalendarFailure = {
  disableCalendar: false,
  retriable: true,
  slug: "provider-calendar-not-found",
};

const resolveResponseStatus = (error: Error): number | null => {
  const candidate = error as Error & Record<string, unknown>;
  if (typeof candidate.status === "number") {
    return candidate.status;
  }
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  return null;
};

const resolveMissingCalendarFailure = (error: unknown): MissingCalendarFailure | null => {
  if (
    error instanceof CalDAVIncompleteMultiGetError
    || error instanceof CalDAVUnreadableResourceError
  ) {
    return null;
  }

  // DrizzleQueryError.message inlines the SQL and every bound parameter, so a UID holding "404" satisfies the substring test below.
  if (!(error instanceof Error) || isDatabaseError(error) || requiresReauthentication(error)) {
    return null;
  }

  const responseStatus = resolveResponseStatus(error);
  if (responseStatus !== null) {
    if (responseStatus === NOT_FOUND_STATUS) {
      return missingCalendarFailure;
    }
    return null;
  }

  if (error.message.includes(String(NOT_FOUND_STATUS))) {
    return missingCalendarFailure;
  }

  return null;
};

const hasOwnSlug = (error: unknown): boolean =>
  error instanceof CalDAVIncompleteMultiGetError
  || error instanceof CalDAVUnreadableResourceError;

const shouldTreatAsProviderAuthFailure = (error: unknown): boolean => {
  if (isTimeoutError(error) || hasOwnSlug(error) || isDatabaseError(error)) {
    return false;
  }
  return isCalDAVAuthenticationError(error);
};

export { resolveMissingCalendarFailure, shouldTreatAsProviderAuthFailure };
export type { MissingCalendarFailure };

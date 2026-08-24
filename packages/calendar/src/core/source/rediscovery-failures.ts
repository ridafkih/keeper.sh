import { isCalDAVAuthenticationError } from "../../providers/caldav/source/auth-error-classification";

const isProviderAuthFailure = (error: unknown): boolean =>
  isCalDAVAuthenticationError(error)
  || (error instanceof Error && "authRequired" in error && error.authRequired === true);

const isProviderTokenRefreshFailure = (error: unknown): boolean =>
  error instanceof Error
  && "oauthReauthRequired" in error
  && error.oauthReauthRequired === true;

const isCalendarListFailure = (error: unknown): error is Error & { status: number } =>
  error instanceof Error && error.name === "CalendarListError" && "status" in error;

export { isCalendarListFailure, isProviderAuthFailure, isProviderTokenRefreshFailure };

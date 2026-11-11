import { isTimeoutError } from "@keeper.sh/calendar";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import {
  CalendarAccountNotFoundError,
  CalendarRefreshUnsupportedError,
  isCalendarListFailure,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
} from "@/utils/calendar-rediscovery";
import type { AccountCalendarRefreshSummary } from "@/utils/calendar-rediscovery";
import type {
  AccountCalendarRefreshTarget,
  RefreshLockClaim,
  RefreshLockHandle,
} from "@/utils/account-calendar-refresh";

interface AccountRefreshRouteDependencies {
  acquireRefreshLock: (accountId: string) => Promise<RefreshLockClaim>;
  refreshCalendars: (target: AccountCalendarRefreshTarget) => Promise<AccountCalendarRefreshSummary>;
}

const REFRESH_IN_PROGRESS_MESSAGE = "This account's calendars are already being refreshed.";
const PROVIDER_REJECTED_MESSAGE =
  "The provider rejected this account's sign-in. Reconnect it, then refresh again.";
const PROVIDER_UNREACHABLE_MESSAGE =
  "Could not reach the provider to list this account's calendars. Try again shortly.";

const toRefreshResponse = (summary: AccountCalendarRefreshSummary): Response => {
  widelog.set("calendar_refresh.added", summary.added.length);
  widelog.set("calendar_refresh.unavailable", summary.unavailable);
  widelog.set("calendar_refresh.revived", summary.revived);
  widelog.set("calendar_refresh.cross_account_skipped", summary.crossAccountSkipped);
  widelog.set("calendar_refresh.suppressed", summary.suppressed);

  return Response.json({
    imported: summary.added.length,
    missing: summary.unavailable,
    restored: summary.revived,
  });
};

const toFailureResponse = (error: unknown): Response => {
  if (error instanceof CalendarAccountNotFoundError) {
    widelog.errorFields(error, { slug: "refresh-account-not-found" });
    return ErrorResponse.notFound(error.message).toResponse();
  }
  if (error instanceof CalendarRefreshUnsupportedError) {
    widelog.errorFields(error, { slug: "refresh-unsupported" });
    return ErrorResponse.badRequest(error.message).toResponse();
  }
  if (isProviderAuthFailure(error) || isProviderTokenRefreshFailure(error)) {
    widelog.errorFields(error, { requiresReauth: true, retriable: false, slug: "provider-auth-failed" });
    return ErrorResponse.unauthorized(PROVIDER_REJECTED_MESSAGE).toResponse();
  }
  if (isTimeoutError(error) || isCalendarListFailure(error)) {
    widelog.errorFields(error, { retriable: true, slug: "provider-api-error" });
    return ErrorResponse.badRequest(PROVIDER_UNREACHABLE_MESSAGE).toResponse();
  }
  throw error;
};

const releaseRefreshLock = async (handle: RefreshLockHandle): Promise<void> => {
  try {
    await handle.release();
  } catch (error) {
    widelog.set("calendar_refresh.lock_release_failed", true);
    widelog.errorFields(error, { retriable: true, slug: "refresh-lock-release-failed" });
  }
};

const handleAccountRefreshRoute = async (
  target: AccountCalendarRefreshTarget,
  dependencies: AccountRefreshRouteDependencies,
): Promise<Response> => {
  widelog.set("user.id", target.userId);
  widelog.set("calendar_refresh.account_id", target.accountId);

  const lock = await dependencies.acquireRefreshLock(target.accountId);
  if (!lock.acquired) {
    widelog.set("calendar_refresh.skipped", true);
    return ErrorResponse.conflict(REFRESH_IN_PROGRESS_MESSAGE).toResponse();
  }

  try {
    return toRefreshResponse(await dependencies.refreshCalendars(target));
  } catch (error) {
    return toFailureResponse(error);
  } finally {
    await releaseRefreshLock(lock.handle);
  }
};

export { handleAccountRefreshRoute };
export type { AccountRefreshRouteDependencies };

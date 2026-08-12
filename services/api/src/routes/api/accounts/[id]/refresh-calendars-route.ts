import { HTTP_STATUS } from "@keeper.sh/constants";
import { isTimeoutError } from "@keeper.sh/calendar";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { idParamSchema } from "@/utils/request-query";
import {
  CalendarRefreshUnconfiguredError,
  CalendarRefreshUnsupportedError,
  isCalendarListFailure,
  isProviderAuthFailure,
  isProviderTokenRefreshFailure,
} from "@/utils/calendar-rediscovery";
import type { AccountCalendarRefreshSummary } from "@/utils/calendar-rediscovery";

interface RefreshLockHandle {
  release: () => Promise<void>;
}

type RefreshLockClaim =
  | { acquired: true; handle: RefreshLockHandle }
  | { acquired: false };

type RefreshCooldownClaim =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface RefreshCalendarsRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface RefreshCalendarsRouteDependencies {
  loadAccount: (
    accountId: string,
    userId: string,
  ) => Promise<{ id: string; provider: string } | null>;
  acquireRefreshLock: (accountId: string) => Promise<RefreshLockClaim>;
  claimRefreshCooldown: (accountId: string) => Promise<RefreshCooldownClaim>;
  refreshCalendars: (
    options: { accountId: string; userId: string },
  ) => Promise<AccountCalendarRefreshSummary>;
}

const toSummaryResponse = (summary: AccountCalendarRefreshSummary): Response =>
  Response.json({
    added: summary.added,
    checkedAt: summary.checkedAt,
    revived: summary.revived,
    suppressed: summary.suppressed,
    unavailable: summary.unavailable,
    unchanged: summary.unchanged,
  });

const toErrorResponse = (error: unknown): Response => {
  if (isProviderAuthFailure(error)) {
    widelog.errorFields(error, {
      slug: "provider-auth-failed",
      retriable: false,
      requiresReauth: true,
    });
    return Response.json(
      { authRequired: true, error: "Reconnect this account to refresh its calendars." },
      { status: HTTP_STATUS.UNAUTHORIZED },
    );
  }

  if (isProviderTokenRefreshFailure(error)) {
    widelog.errorFields(error, {
      slug: "provider-token-refresh-failed",
      retriable: false,
      requiresReauth: true,
    });
    return Response.json(
      { authRequired: true, error: "Reconnect this account to refresh its calendars." },
      { status: HTTP_STATUS.UNAUTHORIZED },
    );
  }

  if (error instanceof CalendarRefreshUnconfiguredError) {
    widelog.errorFields(error, { slug: "refresh-encryption-key-missing", retriable: false });
    return ErrorResponse.internal(
      "This server is not configured for CalDAV calendar refresh.",
    ).toResponse();
  }

  if (error instanceof CalendarRefreshUnsupportedError) {
    widelog.errorFields(error, { slug: "refresh-unsupported", retriable: false });
    return ErrorResponse.badRequest(error.message).toResponse();
  }

  if (isTimeoutError(error)) {
    widelog.errorFields(error, { slug: "provider-request-timeout", retriable: true });
    return ErrorResponse.badRequest(
      "The calendar provider timed out. Try refreshing again in a moment.",
    ).toResponse();
  }

  if (isCalendarListFailure(error)) {
    widelog.errorFields(error, { slug: "provider-api-error", retriable: true });
    return ErrorResponse.badRequest(error.message).toResponse();
  }

  throw error;
};

const runRefresh = async (
  accountId: string,
  context: RefreshCalendarsRouteContext,
  dependencies: RefreshCalendarsRouteDependencies,
): Promise<Response> => {
  const cooldown = await dependencies.claimRefreshCooldown(accountId);
  if (!cooldown.allowed) {
    widelog.set("calendar_refresh.throttled", true);
    widelog.set("calendar_refresh.retry_after_seconds", cooldown.retryAfterSeconds);
    const throttled = ErrorResponse.tooManyRequests(
      `A calendar refresh was already requested recently. Try again in ${cooldown.retryAfterSeconds} seconds.`,
    ).toResponse();
    throttled.headers.set("Retry-After", String(cooldown.retryAfterSeconds));
    return throttled;
  }

  try {
    const summary = await dependencies.refreshCalendars({
      accountId,
      userId: context.userId,
    });

    widelog.set("calendar_refresh.discovered", summary.discovered);
    widelog.set("calendar_refresh.added", summary.added.length);
    widelog.set("calendar_refresh.revived", summary.revived);
    widelog.set("calendar_refresh.unavailable", summary.unavailable);
    widelog.set("calendar_refresh.unchanged", summary.unchanged);
    widelog.set("calendar_refresh.duplicates", summary.duplicates);
    widelog.set("calendar_refresh.cross_account_skipped", summary.crossAccountSkipped);
    widelog.set("calendar_refresh.suppressed", summary.suppressed);

    return toSummaryResponse(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
};

const handleRefreshCalendarsRoute = async (
  context: RefreshCalendarsRouteContext,
  dependencies: RefreshCalendarsRouteDependencies,
): Promise<Response> => {
  if (!context.params.id || !idParamSchema.allows(context.params)) {
    return ErrorResponse.badRequest("Account ID is required").toResponse();
  }
  const accountId = context.params.id;

  const account = await dependencies.loadAccount(accountId, context.userId);
  if (!account) {
    return ErrorResponse.notFound("Account not found").toResponse();
  }

  widelog.set("provider.name", account.provider);
  widelog.set("provider.account_id", account.id);
  widelog.set("user.id", context.userId);

  const lock = await dependencies.acquireRefreshLock(accountId);
  if (!lock.acquired) {
    widelog.set("calendar_refresh.lock_contended", true);
    return ErrorResponse.conflict(
      "A calendar refresh is already running for this account.",
    ).toResponse();
  }

  try {
    return await runRefresh(accountId, context, dependencies);
  } finally {
    await lock.handle.release();
  }
};

export { handleRefreshCalendarsRoute };
export type { RefreshCalendarsRouteDependencies };

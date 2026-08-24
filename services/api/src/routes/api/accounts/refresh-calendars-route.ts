import { isTimeoutError } from "@keeper.sh/calendar";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
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
  userId: string;
}

interface RefreshableAccountRef {
  id: string;
  provider: string;
}

interface RefreshCalendarsRouteDependencies {
  loadAccounts: (userId: string) => Promise<RefreshableAccountRef[]>;
  acquireRefreshLock: (accountId: string) => Promise<RefreshLockClaim>;
  claimRefreshCooldown: (userId: string) => Promise<RefreshCooldownClaim>;
  refreshCalendars: (
    options: { accountId: string; userId: string },
  ) => Promise<AccountCalendarRefreshSummary>;
  runConcurrently: <TResult>(
    tasks: (() => Promise<TResult>)[],
  ) => Promise<PromiseSettledResult<TResult>[]>;
  cooldownSeconds: number;
}

interface RefreshTotals {
  added: number;
  failed: number;
  refreshed: number;
  revived: number;
  skipped: number;
  unavailable: number;
}

const EMPTY_TOTALS: RefreshTotals = {
  added: 0,
  failed: 0,
  refreshed: 0,
  revived: 0,
  skipped: 0,
  unavailable: 0,
};

const resolveFailureSlug = (error: unknown): string => {
  if (isProviderTokenRefreshFailure(error)) {
    return "provider-token-refresh-failed";
  }
  if (isProviderAuthFailure(error)) {
    return "provider-auth-failed";
  }
  if (error instanceof CalendarRefreshUnconfiguredError) {
    return "refresh-encryption-key-missing";
  }
  if (error instanceof CalendarRefreshUnsupportedError) {
    return "refresh-unsupported";
  }
  if (isTimeoutError(error)) {
    return "provider-request-timeout";
  }
  if (isCalendarListFailure(error)) {
    return "provider-api-error";
  }
  return "refresh-failed";
};

const releaseRefreshLock = async (
  handle: RefreshLockHandle,
  accountId: string,
): Promise<void> => {
  try {
    await handle.release();
  } catch (error) {
    widelog.set("calendar_refresh.lock_release_failed_account_id", accountId);
    widelog.errorFields(error, { slug: "refresh-lock-release-failed", retriable: true });
  }
};

const refreshAccount = async (
  account: RefreshableAccountRef,
  context: RefreshCalendarsRouteContext,
  dependencies: RefreshCalendarsRouteDependencies,
): Promise<RefreshTotals> => {
  const lock = await dependencies.acquireRefreshLock(account.id);
  if (!lock.acquired) {
    return { ...EMPTY_TOTALS, skipped: 1 };
  }

  try {
    const summary = await dependencies.refreshCalendars({
      accountId: account.id,
      userId: context.userId,
    });

    return {
      ...EMPTY_TOTALS,
      added: summary.added.length,
      refreshed: 1,
      revived: summary.revived,
      unavailable: summary.unavailable,
    };
  } catch (error) {
    const requiresReauth = isProviderAuthFailure(error)
      || isProviderTokenRefreshFailure(error);
    widelog.set("calendar_refresh.failed_provider", account.provider);
    widelog.set("calendar_refresh.failed_account_id", account.id);
    widelog.errorFields(error, {
      slug: resolveFailureSlug(error),
      retriable: !requiresReauth,
      requiresReauth,
    });
    return { ...EMPTY_TOTALS, failed: 1 };
  } finally {
    await releaseRefreshLock(lock.handle, account.id);
  }
};

const sumTotals = (left: RefreshTotals, right: RefreshTotals): RefreshTotals => ({
  added: left.added + right.added,
  failed: left.failed + right.failed,
  refreshed: left.refreshed + right.refreshed,
  revived: left.revived + right.revived,
  skipped: left.skipped + right.skipped,
  unavailable: left.unavailable + right.unavailable,
});

const handleRefreshCalendarsRoute = async (
  context: RefreshCalendarsRouteContext,
  dependencies: RefreshCalendarsRouteDependencies,
): Promise<Response> => {
  widelog.set("user.id", context.userId);

  const cooldown = await dependencies.claimRefreshCooldown(context.userId);
  if (!cooldown.allowed) {
    widelog.set("calendar_refresh.throttled", true);
    widelog.set("calendar_refresh.retry_after_seconds", cooldown.retryAfterSeconds);
    const throttled = ErrorResponse.tooManyRequests(
      `A calendar refresh was already requested recently. Try again in ${cooldown.retryAfterSeconds} seconds.`,
    ).toResponse();
    throttled.headers.set("Retry-After", String(cooldown.retryAfterSeconds));
    return throttled;
  }

  const accounts = await dependencies.loadAccounts(context.userId);
  widelog.set("calendar_refresh.accounts", accounts.length);

  const settlements = await dependencies.runConcurrently(
    accounts.map((account) => () => refreshAccount(account, context, dependencies)),
  );

  let totals = EMPTY_TOTALS;
  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      totals = sumTotals(totals, settlement.value);
      continue;
    }
    widelog.errorFields(settlement.reason, { slug: "refresh-failed", retriable: true });
    totals = sumTotals(totals, { ...EMPTY_TOTALS, failed: 1 });
  }

  widelog.set("calendar_refresh.added", totals.added);
  widelog.set("calendar_refresh.revived", totals.revived);
  widelog.set("calendar_refresh.unavailable", totals.unavailable);
  widelog.set("calendar_refresh.accounts_refreshed", totals.refreshed);
  widelog.set("calendar_refresh.accounts_failed", totals.failed);
  widelog.set("calendar_refresh.accounts_skipped", totals.skipped);

  return Response.json({
    accounts: accounts.length,
    added: totals.added,
    cooldownSeconds: dependencies.cooldownSeconds,
    failed: totals.failed,
    refreshed: totals.refreshed,
    revived: totals.revived,
    skipped: totals.skipped,
    unavailable: totals.unavailable,
  });
};

export { handleRefreshCalendarsRoute };
export type { RefreshCalendarsRouteDependencies };

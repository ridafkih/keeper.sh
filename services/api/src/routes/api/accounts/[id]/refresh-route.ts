import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { AccountNotFoundError } from "@/utils/refresh-account-calendars";
import type { RefreshAccountCalendarsResult } from "@/utils/refresh-account-calendars";
import { isProviderAuthFailure, isProviderTokenRefreshFailure } from "@/utils/calendar-rediscovery";

const CALENDAR_ACCESS_REQUIRED_MESSAGE =
  "Keeper.sh can't read the calendars on this account. Reconnect it and allow calendar access.";

interface AccountRefreshRouteContext {
  accountId: string;
  userId: string;
}

interface AccountRefreshRouteDependencies {
  refreshAccountCalendars: (
    userId: string,
    accountId: string,
  ) => Promise<RefreshAccountCalendarsResult>;
  markNeedsReauthentication: (accountId: string) => Promise<void>;
}

const resolveReauthSlug = (error: unknown): string => {
  if (isProviderTokenRefreshFailure(error)) {
    return "provider-token-refresh-failed";
  }
  return "provider-auth-failed";
};

const handleAccountRefreshRoute = async (
  context: AccountRefreshRouteContext,
  dependencies: AccountRefreshRouteDependencies,
): Promise<Response> => {
  try {
    const result = await dependencies.refreshAccountCalendars(context.userId, context.accountId);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      return ErrorResponse.notFound(error.message).toResponse();
    }
    if (!isProviderAuthFailure(error) && !isProviderTokenRefreshFailure(error)) {
      throw error;
    }
    await dependencies.markNeedsReauthentication(context.accountId);
    widelog.errorFields(error, {
      requiresReauth: true,
      retriable: false,
      slug: resolveReauthSlug(error),
    });
    return ErrorResponse.conflict(CALENDAR_ACCESS_REQUIRED_MESSAGE).toResponse();
  }
};

export { CALENDAR_ACCESS_REQUIRED_MESSAGE, handleAccountRefreshRoute };
export type { AccountRefreshRouteDependencies };

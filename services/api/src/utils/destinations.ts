import type {
  AuthorizationUrlOptions,
  OAuthTokens,
  NormalizedUserInfo as OAuthUserInfo,
  ValidatedState,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { database, oauthProviders, redis } from "@/context";
import { invalidateCalendarsForAccount } from "@/utils/invalidate-calendars";
import { saveCalDAVDestinationWithDatabase } from "./caldav-destination-repository";
import {
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
  DestinationAccountOwnershipError,
  OAuthCredentialCreateError,
  OAuthProviderNotFoundError,
} from "./destination-errors";
import { saveCalendarDestinationWithDatabase } from "./oauth-destination-repository";

const FIRST_RESULT_LIMIT = 1;
const EMPTY_RESULT_COUNT = 0;

interface CalendarDestination {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

const isOAuthProvider = (provider: string): boolean => oauthProviders.isOAuthProvider(provider);

const hasRequiredScopes = (provider: string, grantedScopes: string): boolean =>
  oauthProviders.hasRequiredScopes(provider, grantedScopes);

const getOAuthProviderOrThrow = (provider: string) => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new OAuthProviderNotFoundError(provider);
  }
  return oauthProvider;
};

const getAuthorizationUrl = (
  provider: string,
  userId: string,
  options: AuthorizationUrlOptions,
): Promise<string> => getOAuthProviderOrThrow(provider).getAuthorizationUrl(userId, options);

const exchangeCodeForTokens = (
  provider: string,
  code: string,
  callbackUrl: string,
): Promise<OAuthTokens> => getOAuthProviderOrThrow(provider).exchangeCodeForTokens(code, callbackUrl);

const fetchUserInfo = (provider: string, accessToken: string): Promise<OAuthUserInfo> =>
  getOAuthProviderOrThrow(provider).fetchUserInfo(accessToken);

const validateState = (state: string): Promise<ValidatedState | null> => oauthProviders.validateState(state);

const saveCalendarDestination = (
  userId: string,
  provider: string,
  accountId: string,
  email: string | null,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  needsReauthentication = false,
): Promise<void> =>
  saveCalendarDestinationWithDatabase(
    database,
    userId,
    provider,
    accountId,
    email,
    accessToken,
    refreshToken,
    expiresAt,
    needsReauthentication,
  );

const listCalendarDestinations = async (userId: string): Promise<CalendarDestination[]> => {
  const accounts = await database
    .select({
      email: calendarAccountsTable.email,
      id: calendarAccountsTable.id,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      provider: calendarAccountsTable.provider,
    })
    .from(calendarAccountsTable)
    .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        inArray(
          calendarsTable.id,
          database
            .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  return accounts;
};

const deleteCalendarDestination = async (
  userId: string,
  accountId: string,
): Promise<boolean> => {
  await invalidateCalendarsForAccount(database, redis, accountId);

  const result = await database
    .delete(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.id, accountId),
      ),
    )
    .returning({ id: calendarAccountsTable.id });

  return result.length > EMPTY_RESULT_COUNT;
};

const getAccountExternalId = async (userId: string, accountId: string): Promise<string | null> => {
  const [account] = await database
    .select({ accountId: calendarAccountsTable.accountId })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (account?.accountId) {
    return account.accountId;
  }
  return null;
};

const saveCalDAVDestination = (
  userId: string,
  provider: string,
  accountId: string,
  email: string,
  serverUrl: string,
  calendarUrl: string,
  username: string,
  encryptedPassword: string,
): Promise<void> =>
  saveCalDAVDestinationWithDatabase(
    database,
    userId,
    provider,
    accountId,
    email,
    serverUrl,
    calendarUrl,
    username,
    encryptedPassword,
  );

export {
  isOAuthProvider,
  hasRequiredScopes,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  validateState,
  saveCalendarDestination,
  listCalendarDestinations,
  deleteCalendarDestination,
  getAccountExternalId as getDestinationAccountId,
  saveCalDAVDestination,
  saveCalDAVDestinationWithDatabase,
  saveCalendarDestinationWithDatabase,
  OAuthProviderNotFoundError,
  DestinationAccountOwnershipError,
  OAuthCredentialCreateError,
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
};

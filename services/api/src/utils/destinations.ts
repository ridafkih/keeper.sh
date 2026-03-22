import { database } from "@/context";
import { saveCalDAVDestinationWithDatabase } from "./caldav-destination-repository";
import { deleteCalendarDestination } from "./destination-delete-service";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  getAuthorizationUrl,
  hasRequiredScopes,
  isOAuthProvider,
  validateState,
} from "./destination-oauth-provider-gateway";
import {
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
  DestinationAccountOwnershipError,
  OAuthCredentialCreateError,
  OAuthProviderNotFoundError,
} from "./destination-errors";
import {
  getDestinationAccountExternalIdWithDatabase,
  listCalendarDestinationsWithDatabase,
} from "./destination-query-repository";
import { saveCalendarDestinationWithDatabase } from "./oauth-destination-repository";

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

const listCalendarDestinations = (userId: string) =>
  listCalendarDestinationsWithDatabase(database, userId);

const getDestinationAccountId = (userId: string, accountId: string) =>
  getDestinationAccountExternalIdWithDatabase(database, userId, accountId);

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
  getDestinationAccountId,
  saveCalDAVDestination,
  saveCalDAVDestinationWithDatabase,
  saveCalendarDestinationWithDatabase,
  OAuthProviderNotFoundError,
  DestinationAccountOwnershipError,
  OAuthCredentialCreateError,
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
};

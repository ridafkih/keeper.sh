import {
  caldavCredentialsTable,
  calendarDestinationsTable,
  oauthCredentialsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type {
  AuthorizationUrlOptions,
  OAuthTokens,
  NormalizedUserInfo as OAuthUserInfo,
  ValidatedState,
} from "@keeper.sh/provider-core";
import { database, oauthProviders } from "../context";
import { createMappingsForNewDestination } from "./source-destination-mappings";

const FIRST_RESULT_LIMIT = 1;
const EMPTY_RESULT_COUNT = 0;

const isOAuthProvider = (provider: string): boolean => oauthProviders.isOAuthProvider(provider);

const hasRequiredScopes = (provider: string, grantedScopes: string): boolean =>
  oauthProviders.hasRequiredScopes(provider, grantedScopes);

const getAuthorizationUrl = (
  provider: string,
  userId: string,
  options: AuthorizationUrlOptions,
): string => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
  }
  return oauthProvider.getAuthorizationUrl(userId, options);
};

const exchangeCodeForTokens = (
  provider: string,
  code: string,
  callbackUrl: string,
): Promise<OAuthTokens> => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
  }
  return oauthProvider.exchangeCodeForTokens(code, callbackUrl);
};

const fetchUserInfo = (provider: string, accessToken: string): Promise<OAuthUserInfo> => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
  }
  return oauthProvider.fetchUserInfo(accessToken);
};

const validateState = (state: string): ValidatedState | null => oauthProviders.validateState(state);

interface CalendarDestination {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

interface ExistingDestination {
  id: string;
  userId: string;
  oauthCredentialId: string | null;
  caldavCredentialId: string | null;
}

const findExistingDestination = async (
  provider: string,
  accountId: string,
): Promise<ExistingDestination | undefined> => {
  const [destination] = await database
    .select({
      caldavCredentialId: calendarDestinationsTable.caldavCredentialId,
      id: calendarDestinationsTable.id,
      oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      userId: calendarDestinationsTable.userId,
    })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.provider, provider),
        eq(calendarDestinationsTable.accountId, accountId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return destination;
};

const validateDestinationOwnership = (
  existingDestination: ExistingDestination | undefined,
  userId: string,
): void => {
  if (existingDestination && existingDestination.userId !== userId) {
    throw new Error("This account is already linked to another user");
  }
};

const initializeSyncStatus = async (destinationId: string): Promise<void> => {
  await database.insert(syncStatusTable).values({ destinationId }).onConflictDoNothing();
};

const setupNewDestination = async (userId: string, destinationId: string): Promise<void> => {
  await initializeSyncStatus(destinationId);
  await createMappingsForNewDestination(userId, destinationId);
};

interface DestinationInsertData {
  userId: string;
  provider: string;
  accountId: string;
  email: string | null;
  oauthCredentialId?: string;
  caldavCredentialId?: string;
  needsReauthentication?: boolean;
}

const upsertDestination = async (data: DestinationInsertData): Promise<string | undefined> => {
  const { oauthCredentialId, caldavCredentialId, needsReauthentication, ...base } = data;

  const setClause: Record<string, unknown> = { email: base.email };

  if (oauthCredentialId) {
    setClause.oauthCredentialId = oauthCredentialId;
    setClause.needsReauthentication = needsReauthentication ?? false;
  }
  if (caldavCredentialId) {
    setClause.caldavCredentialId = caldavCredentialId;
  }

  const [destination] = await database
    .insert(calendarDestinationsTable)
    .values({
      ...base,
      oauthCredentialId,
      caldavCredentialId,
      needsReauthentication,
    })
    .onConflictDoUpdate({
      set: setClause,
      target: [calendarDestinationsTable.provider, calendarDestinationsTable.accountId],
    })
    .returning({ id: calendarDestinationsTable.id });

  return destination?.id;
};

const saveCalendarDestination = async (
  userId: string,
  provider: string,
  accountId: string,
  email: string | null,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  needsReauthentication = false,
): Promise<void> => {
  const existingDestination = await findExistingDestination(provider, accountId);
  validateDestinationOwnership(existingDestination, userId);

  if (existingDestination?.oauthCredentialId) {
    await database
      .update(oauthCredentialsTable)
      .set({ accessToken, expiresAt, refreshToken })
      .where(eq(oauthCredentialsTable.id, existingDestination.oauthCredentialId));

    await database
      .update(calendarDestinationsTable)
      .set({ email, needsReauthentication })
      .where(eq(calendarDestinationsTable.id, existingDestination.id));

    await initializeSyncStatus(existingDestination.id);
    return;
  }

  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({ accessToken, expiresAt, refreshToken })
    .returning({ id: oauthCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create OAuth credentials");
  }

  const destinationId = await upsertDestination({
    accountId,
    email,
    needsReauthentication,
    oauthCredentialId: credential.id,
    provider,
    userId,
  });

  if (destinationId) {
    await setupNewDestination(userId, destinationId);
  }
};

const listCalendarDestinations = async (userId: string): Promise<CalendarDestination[]> => {
  const destinations = await database
    .select({
      email: calendarDestinationsTable.email,
      id: calendarDestinationsTable.id,
      needsReauthentication: calendarDestinationsTable.needsReauthentication,
      provider: calendarDestinationsTable.provider,
    })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  return destinations;
};

const deleteCalendarDestination = async (
  userId: string,
  destinationId: string,
): Promise<boolean> => {
  const result = await database
    .delete(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.userId, userId),
        eq(calendarDestinationsTable.id, destinationId),
      ),
    )
    .returning({ id: calendarDestinationsTable.id });

  return result.length > EMPTY_RESULT_COUNT;
};

const getDestinationAccountId = async (destinationId: string): Promise<string | null> => {
  const [destination] = await database
    .select({ accountId: calendarDestinationsTable.accountId })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.id, destinationId))
    .limit(FIRST_RESULT_LIMIT);

  if (destination?.accountId) {
    return destination.accountId;
  }
  return null;
};

const saveCalDAVDestination = async (
  userId: string,
  provider: string,
  accountId: string,
  email: string,
  serverUrl: string,
  calendarUrl: string,
  username: string,
  encryptedPassword: string,
): Promise<void> => {
  const existingDestination = await findExistingDestination(provider, accountId);
  validateDestinationOwnership(existingDestination, userId);

  if (existingDestination?.caldavCredentialId) {
    await database
      .update(caldavCredentialsTable)
      .set({ calendarUrl, encryptedPassword, serverUrl, username })
      .where(eq(caldavCredentialsTable.id, existingDestination.caldavCredentialId));

    await database
      .update(calendarDestinationsTable)
      .set({ email })
      .where(eq(calendarDestinationsTable.id, existingDestination.id));

    await initializeSyncStatus(existingDestination.id);
    return;
  }

  const [credential] = await database
    .insert(caldavCredentialsTable)
    .values({ calendarUrl, encryptedPassword, serverUrl, username })
    .returning({ id: caldavCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create CalDAV credentials");
  }

  const destinationId = await upsertDestination({
    accountId,
    caldavCredentialId: credential.id,
    email,
    provider,
    userId,
  });

  if (destinationId) {
    await setupNewDestination(userId, destinationId);
  }
};

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
};

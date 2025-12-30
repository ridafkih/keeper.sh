import {
  calendarDestinationsTable,
  oauthCredentialsTable,
  caldavCredentialsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { eq, and } from "drizzle-orm";
import type { AuthorizationUrlOptions } from "@keeper.sh/destination-providers";
import { database, oauthProviders } from "../context";
import { triggerDestinationSync } from "./sync";

export const isOAuthProvider = (provider: string): boolean => {
  return oauthProviders.isOAuthProvider(provider);
};

export const hasRequiredScopes = (provider: string, grantedScopes: string): boolean => {
  return oauthProviders.hasRequiredScopes(provider, grantedScopes);
};

export const getAuthorizationUrl = (
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

export const exchangeCodeForTokens = async (
  provider: string,
  code: string,
  callbackUrl: string,
) => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
  }
  return oauthProvider.exchangeCodeForTokens(code, callbackUrl);
};

export const fetchUserInfo = async (provider: string, accessToken: string) => {
  const oauthProvider = oauthProviders.getProvider(provider);
  if (!oauthProvider) {
    throw new Error(`OAuth provider not found: ${provider}`);
  }
  return oauthProvider.fetchUserInfo(accessToken);
};

export const validateState = (state: string) => {
  return oauthProviders.validateState(state);
};

interface CalendarDestination {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

export const saveCalendarDestination = async (
  userId: string,
  provider: string,
  accountId: string,
  email: string | null,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  needsReauthentication: boolean = false,
): Promise<void> => {
  const [existingDestination] = await database
    .select({
      id: calendarDestinationsTable.id,
      userId: calendarDestinationsTable.userId,
      oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
    })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.provider, provider),
        eq(calendarDestinationsTable.accountId, accountId),
      ),
    )
    .limit(1);

  if (existingDestination && existingDestination.userId !== userId) {
    throw new Error("This account is already linked to another user");
  }

  if (existingDestination?.oauthCredentialId) {
    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken,
        refreshToken,
        expiresAt,
      })
      .where(eq(oauthCredentialsTable.id, existingDestination.oauthCredentialId));

    await database
      .update(calendarDestinationsTable)
      .set({ email, needsReauthentication })
      .where(eq(calendarDestinationsTable.id, existingDestination.id));

    await database
      .insert(syncStatusTable)
      .values({ destinationId: existingDestination.id })
      .onConflictDoNothing();
  } else {
    const [credential] = await database
      .insert(oauthCredentialsTable)
      .values({
        accessToken,
        refreshToken,
        expiresAt,
      })
      .returning({ id: oauthCredentialsTable.id });

    if (!credential) {
      throw new Error("Failed to create OAuth credentials");
    }

    const [destination] = await database
      .insert(calendarDestinationsTable)
      .values({
        userId,
        provider,
        accountId,
        email,
        oauthCredentialId: credential.id,
        needsReauthentication,
      })
      .onConflictDoUpdate({
        target: [
          calendarDestinationsTable.provider,
          calendarDestinationsTable.accountId,
        ],
        set: {
          email,
          oauthCredentialId: credential.id,
          needsReauthentication,
        },
      })
      .returning({ id: calendarDestinationsTable.id });

    if (destination) {
      await database
        .insert(syncStatusTable)
        .values({ destinationId: destination.id })
        .onConflictDoNothing();
    }
  }
};

export const listCalendarDestinations = async (
  userId: string,
): Promise<CalendarDestination[]> => {
  const destinations = await database
    .select({
      id: calendarDestinationsTable.id,
      provider: calendarDestinationsTable.provider,
      email: calendarDestinationsTable.email,
      needsReauthentication: calendarDestinationsTable.needsReauthentication,
    })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  return destinations;
};

export const deleteCalendarDestination = async (
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

  return result.length > 0;
};

export const getDestinationAccountId = async (
  destinationId: string,
): Promise<string | null> => {
  const [destination] = await database
    .select({ accountId: calendarDestinationsTable.accountId })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.id, destinationId))
    .limit(1);

  return destination?.accountId ?? null;
};

export const saveCalDAVDestination = async (
  userId: string,
  provider: string,
  accountId: string,
  email: string,
  serverUrl: string,
  calendarUrl: string,
  username: string,
  encryptedPassword: string,
): Promise<void> => {
  const [existingDestination] = await database
    .select({
      id: calendarDestinationsTable.id,
      userId: calendarDestinationsTable.userId,
      caldavCredentialId: calendarDestinationsTable.caldavCredentialId,
    })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.provider, provider),
        eq(calendarDestinationsTable.accountId, accountId),
      ),
    )
    .limit(1);

  if (existingDestination && existingDestination.userId !== userId) {
    throw new Error("This account is already linked to another user");
  }

  if (existingDestination?.caldavCredentialId) {
    await database
      .update(caldavCredentialsTable)
      .set({
        serverUrl,
        calendarUrl,
        username,
        encryptedPassword,
      })
      .where(eq(caldavCredentialsTable.id, existingDestination.caldavCredentialId));

    await database
      .update(calendarDestinationsTable)
      .set({ email })
      .where(eq(calendarDestinationsTable.id, existingDestination.id));

    await database
      .insert(syncStatusTable)
      .values({ destinationId: existingDestination.id })
      .onConflictDoNothing();
  } else {
    const [credential] = await database
      .insert(caldavCredentialsTable)
      .values({
        serverUrl,
        calendarUrl,
        username,
        encryptedPassword,
      })
      .returning({ id: caldavCredentialsTable.id });

    if (!credential) {
      throw new Error("Failed to create CalDAV credentials");
    }

    const [destination] = await database
      .insert(calendarDestinationsTable)
      .values({
        userId,
        provider,
        accountId,
        email,
        caldavCredentialId: credential.id,
      })
      .onConflictDoUpdate({
        target: [
          calendarDestinationsTable.provider,
          calendarDestinationsTable.accountId,
        ],
        set: {
          email,
          caldavCredentialId: credential.id,
        },
      })
      .returning({ id: calendarDestinationsTable.id });

    if (destination) {
      await database
        .insert(syncStatusTable)
        .values({ destinationId: destination.id })
        .onConflictDoNothing();
    }
  }
};

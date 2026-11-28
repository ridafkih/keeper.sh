import type { CalendarSyncProvider, RefreshLockStore } from "@keeper.sh/calendar";
import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import {
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
  readCredentialTokens,
} from "@keeper.sh/calendar";
import { createGoogleSyncProvider } from "@keeper.sh/calendar/google";
import { createOutlookSyncProvider } from "@keeper.sh/calendar/outlook";
import { createCalDAVSyncProvider } from "@keeper.sh/calendar/caldav";
import { resolveAuthMethod } from "@keeper.sh/calendar/digest-fetch";
import { PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import { hasEncryptionKey, openSecret } from "@keeper.sh/database";
import type { Keyring } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const OAUTH_PROVIDERS = new Set(["google", "outlook"]);
const CALDAV_PROVIDERS = new Set(["caldav", "fastmail", "icloud"]);

interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
}

const resolveOAuthProvider = async (
  database: BunSQLDatabase,
  provider: string,
  calendarId: string,
  userId: string,
  accountId: string,
  oauthConfig: OAuthConfig,
  keyring: Keyring,
  refreshLockStore: RefreshLockStore | null,
  rateLimiter?: RedisRateLimiter,
  signal?: AbortSignal,
): Promise<CalendarSyncProvider | null> => {
  const [oauthCred] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      externalCalendarId: calendarsTable.externalCalendarId,
      oauthCredentialId: oauthCredentialsTable.id,
    })
    .from(oauthCredentialsTable)
    .innerJoin(calendarAccountsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);

  if (!oauthCred) {
    return null;
  }

  const tokens = readCredentialTokens(oauthCred, keyring);

  if (provider === "google" && oauthConfig.googleClientId && oauthConfig.googleClientSecret) {
    if (!oauthCred.externalCalendarId) {
      return null;
    }
    const refreshGoogleToken = createGoogleTokenRefresher({
      clientId: oauthConfig.googleClientId,
      clientSecret: oauthConfig.googleClientSecret,
    });
    return createGoogleSyncProvider({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: oauthCred.externalCalendarId,
      calendarId,
      userId,
      refreshAccessToken: createCoordinatedRefresher({
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
        keyring,
        refreshLockStore,
        rawRefresh: (refreshToken) => refreshGoogleToken(refreshToken),
      }),
      rateLimiter,
      signal,
    });
  }

  if (provider === "outlook" && oauthConfig.microsoftClientId && oauthConfig.microsoftClientSecret) {
    if (!oauthCred.externalCalendarId) {
      return null;
    }
    const refreshMicrosoftToken = createMicrosoftTokenRefresher({
      clientId: oauthConfig.microsoftClientId,
      clientSecret: oauthConfig.microsoftClientSecret,
    });
    return createOutlookSyncProvider({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: oauthCred.externalCalendarId,
      calendarId,
      userId,
      refreshAccessToken: createCoordinatedRefresher({
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
        keyring,
        refreshLockStore,
        rawRefresh: (refreshToken) => refreshMicrosoftToken(refreshToken),
      }),
      rateLimiter,
      signal,
    });
  }

  return null;
};

const resolveCalDAVProvider = async (
  database: BunSQLDatabase,
  calendarId: string,
  keyring: Keyring,
  safeFetchOptions?: SafeFetchOptions,
  rateLimiter?: RedisRateLimiter,
  signal?: AbortSignal,
): Promise<CalendarSyncProvider | null> => {
  const [caldavCred] = await database
    .select({
      authMethod: caldavCredentialsTable.authMethod,
      caldavCredentialId: caldavCredentialsTable.id,
      username: caldavCredentialsTable.username,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      serverUrl: caldavCredentialsTable.serverUrl,
      calendarUrl: calendarsTable.calendarUrl,
    })
    .from(caldavCredentialsTable)
    .innerJoin(calendarAccountsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);

  if (!caldavCred) {
    return null;
  }

  const password = openSecret(
    caldavCred.encryptedPassword,
    keyring,
    caldavCred.caldavCredentialId,
  );

  return createCalDAVSyncProvider({
    authMethod: resolveAuthMethod(caldavCred.authMethod),
    calendarUrl: caldavCred.calendarUrl ?? caldavCred.serverUrl,
    destinationCalendarId: calendarId,
    rateLimiter,
    serverUrl: caldavCred.serverUrl,
    username: caldavCred.username,
    password,
    safeFetchOptions: {
      blockPrivateResolution: true,
      ...safeFetchOptions,
      timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
      signal,
    },
  });
};

interface ResolveProviderOptions {
  database: BunSQLDatabase;
  provider: string;
  calendarId: string;
  userId: string;
  accountId: string;
  oauthConfig: OAuthConfig;
  keyring: Keyring;
  refreshLockStore?: RefreshLockStore | null;
  rateLimiter?: RedisRateLimiter;
  safeFetchOptions?: SafeFetchOptions;
  signal?: AbortSignal;
}

const resolveSyncProvider = (options: ResolveProviderOptions): Promise<CalendarSyncProvider | null> => {
  if (OAUTH_PROVIDERS.has(options.provider)) {
    return resolveOAuthProvider(
      options.database,
      options.provider,
      options.calendarId,
      options.userId,
      options.accountId,
      options.oauthConfig,
      options.keyring,
      options.refreshLockStore ?? null,
      options.rateLimiter,
      options.signal,
    );
  }

  if (CALDAV_PROVIDERS.has(options.provider) && hasEncryptionKey(options.keyring)) {
    return resolveCalDAVProvider(
      options.database,
      options.calendarId,
      options.keyring,
      options.safeFetchOptions,
      options.rateLimiter,
      options.signal,
    );
  }

  return Promise.resolve(null);
};

export { resolveSyncProvider };
export type { OAuthConfig };

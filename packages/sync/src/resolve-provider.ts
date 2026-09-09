import { createEwsTokenProvider, createEwsSyncProvider, parseEwsConfig } from "@keeper.sh/calendar/ews";
import type { CalendarSyncProvider, RefreshLockStore } from "@keeper.sh/calendar";
import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import {
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
} from "@keeper.sh/calendar";
import { createGoogleSyncProvider } from "@keeper.sh/calendar/google";
import { createOutlookSyncProvider } from "@keeper.sh/calendar/outlook";
import { createCalDAVSyncProvider } from "@keeper.sh/calendar/caldav";
import { resolveAuthMethod } from "@keeper.sh/calendar/digest-fetch";
import { PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  ewsCredentialsTable,
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

  if (provider === "google" && oauthConfig.googleClientId && oauthConfig.googleClientSecret) {
    if (!oauthCred.externalCalendarId) {
      return null;
    }
    const refreshGoogleToken = createGoogleTokenRefresher({
      clientId: oauthConfig.googleClientId,
      clientSecret: oauthConfig.googleClientSecret,
    });
    return createGoogleSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: oauthCred.externalCalendarId,
      calendarId,
      userId,
      refreshAccessToken: createCoordinatedRefresher({
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
        refreshLockStore,
        rawRefresh: (refreshToken) => refreshGoogleToken(refreshToken),
      }),
      rateLimiter,
      signal,
    });
  }

  if (provider === "outlook") {
    if (!oauthCred.externalCalendarId) {
      return null;
    }
    const refreshMicrosoftToken = createMicrosoftTokenRefresher({
      clientId: oauthConfig.microsoftClientId ?? "",
      clientSecret: oauthConfig.microsoftClientSecret ?? "",
    });
    return createOutlookSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: oauthCred.externalCalendarId,
      calendarId,
      userId,
      refreshAccessToken: createCoordinatedRefresher({
        microsoft: provider === "outlook",
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
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
  encryptionKey: string,
  safeFetchOptions?: SafeFetchOptions,
  signal?: AbortSignal,
): Promise<CalendarSyncProvider | null> => {
  const [caldavCred] = await database
    .select({
      authMethod: caldavCredentialsTable.authMethod,
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

  const password = decryptPassword(caldavCred.encryptedPassword, encryptionKey);

  return createCalDAVSyncProvider({
    authMethod: resolveAuthMethod(caldavCred.authMethod),
    calendarUrl: caldavCred.calendarUrl ?? caldavCred.serverUrl,
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
  encryptionKey?: string;
  refreshLockStore?: RefreshLockStore | null;
  rateLimiter?: RedisRateLimiter;
  safeFetchOptions?: SafeFetchOptions;
  signal?: AbortSignal;
}

const resolveSyncProvider = async (options: ResolveProviderOptions): Promise<CalendarSyncProvider | null> => {
  if (options.provider === "ews" && options.encryptionKey) {
    const [row] = await options.database.select({
      accountId: ewsCredentialsTable.accountId,
      encryptedConfig: ewsCredentialsTable.encryptedConfig,
      externalCalendarId: calendarsTable.externalCalendarId,
    }).from(calendarsTable)
      .innerJoin(ewsCredentialsTable, eq(ewsCredentialsTable.accountId, calendarsTable.accountId))
      .where(eq(calendarsTable.id, options.calendarId)).limit(1);
    if (!row?.externalCalendarId) { return null; }
    return createEwsSyncProvider({
      connection: parseEwsConfig(JSON.parse(decryptPassword(row.encryptedConfig, options.encryptionKey))),
      calendarId: row.externalCalendarId,
      getAccessToken: createEwsTokenProvider(options.database, row.accountId, options.encryptionKey, { safeFetchOptions: { ...options.safeFetchOptions, signal: options.signal } }),
      safeFetchOptions: { blockPrivateResolution: true, ...options.safeFetchOptions, signal: options.signal },
    });
  }
  if (OAUTH_PROVIDERS.has(options.provider)) {
    return resolveOAuthProvider(
      options.database,
      options.provider,
      options.calendarId,
      options.userId,
      options.accountId,
      options.oauthConfig,
      options.refreshLockStore ?? null,
      options.rateLimiter,
      options.signal,
    );
  }

  if (CALDAV_PROVIDERS.has(options.provider) && options.encryptionKey) {
    return resolveCalDAVProvider(
      options.database,
      options.calendarId,
      options.encryptionKey,
      options.safeFetchOptions,
      options.signal,
    );
  }

  return null;
};

export { resolveSyncProvider };
export type { OAuthConfig };

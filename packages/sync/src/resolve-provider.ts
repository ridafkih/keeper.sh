import type { CalendarSyncProvider, RefreshLockStore } from "@keeper.sh/calendar";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import {
  createGoogleOAuthService,
  createMicrosoftOAuthService,
  runWithCredentialRefreshLock,
  isOAuthReauthRequiredError,
} from "@keeper.sh/calendar";
import { createGoogleSyncProvider } from "@keeper.sh/calendar/google";
import { createOutlookSyncProvider } from "@keeper.sh/calendar/outlook";
import { createCalDAVSyncProvider } from "@keeper.sh/calendar/caldav";
import { decryptPassword } from "@keeper.sh/database";
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

const MS_PER_SECOND = 1000;

interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
}

interface CoordinatedRefresherOptions {
  database: BunSQLDatabase;
  oauthCredentialId: string;
  calendarAccountId: string;
  refreshLockStore: RefreshLockStore | null;
  rawRefresh: (refreshToken: string) => Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
}

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const { database, oauthCredentialId, calendarAccountId, refreshLockStore, rawRefresh } = options;

  return (refreshToken: string) =>
    runWithCredentialRefreshLock(
      oauthCredentialId,
      async () => {
        try {
          const result = await rawRefresh(refreshToken);

          const newExpiresAt = new Date(Date.now() + result.expires_in * MS_PER_SECOND);

          await database
            .update(oauthCredentialsTable)
            .set({
              accessToken: result.access_token,
              expiresAt: newExpiresAt,
              refreshToken: result.refresh_token ?? refreshToken,
            })
            .where(eq(oauthCredentialsTable.id, oauthCredentialId));

          return result;
        } catch (error) {
          if (isOAuthReauthRequiredError(error)) {
            await database
              .update(calendarAccountsTable)
              .set({ needsReauthentication: true })
              .where(eq(calendarAccountsTable.id, calendarAccountId));
          }
          throw error;
        }
      },
      refreshLockStore,
    );
};

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
    const googleOAuth = createGoogleOAuthService({
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
        rawRefresh: (refreshToken) => googleOAuth.refreshAccessToken(refreshToken),
      }),
      rateLimiter,
      signal,
    });
  }

  if (provider === "outlook" && oauthConfig.microsoftClientId && oauthConfig.microsoftClientSecret) {
    if (!oauthCred.externalCalendarId) {
      return null;
    }
    const microsoftOAuth = createMicrosoftOAuthService({
      clientId: oauthConfig.microsoftClientId,
      clientSecret: oauthConfig.microsoftClientSecret,
    });
    return createOutlookSyncProvider({
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
        rawRefresh: (refreshToken) => microsoftOAuth.refreshAccessToken(refreshToken),
      }),
    });
  }

  return null;
};

const resolveCalDAVProvider = async (
  database: BunSQLDatabase,
  calendarId: string,
  encryptionKey: string,
): Promise<CalendarSyncProvider | null> => {
  const [caldavCred] = await database
    .select({
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
    calendarUrl: caldavCred.calendarUrl ?? caldavCred.serverUrl,
    serverUrl: caldavCred.serverUrl,
    username: caldavCred.username,
    password,
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
    );
  }

  return Promise.resolve(null);
};

export { resolveSyncProvider };
export type { OAuthConfig };

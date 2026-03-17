import type { CalendarSyncProvider } from "@keeper.sh/calendar";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import {
  createGoogleOAuthService,
  createMicrosoftOAuthService,
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
  rateLimiter?: RedisRateLimiter,
): Promise<CalendarSyncProvider | null> => {
  const [oauthCred] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
    })
    .from(oauthCredentialsTable)
    .innerJoin(calendarAccountsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);

  if (!oauthCred) {
    return null;
  }

  if (provider === "google" && oauthConfig.googleClientId && oauthConfig.googleClientSecret) {
    const googleOAuth = createGoogleOAuthService({
      clientId: oauthConfig.googleClientId,
      clientSecret: oauthConfig.googleClientSecret,
    });
    return createGoogleSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: "primary",
      calendarId,
      userId,
      refreshAccessToken: (refreshToken) => googleOAuth.refreshAccessToken(refreshToken),
      rateLimiter,
    });
  }

  if (provider === "outlook" && oauthConfig.microsoftClientId && oauthConfig.microsoftClientSecret) {
    const microsoftOAuth = createMicrosoftOAuthService({
      clientId: oauthConfig.microsoftClientId,
      clientSecret: oauthConfig.microsoftClientSecret,
    });
    return createOutlookSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      calendarId,
      userId,
      refreshAccessToken: (refreshToken) => microsoftOAuth.refreshAccessToken(refreshToken),
      rateLimiter,
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
  rateLimiter?: RedisRateLimiter;
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
      options.rateLimiter,
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

import type { CalendarSyncProvider, RefreshLockStore } from "@keeper.sh/calendar";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import { RedisCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import type Redis from "ioredis";
import {
  createGoogleOAuthService,
  createMicrosoftOAuthService,
  type OAuthRefreshResult,
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
import { createCredentialHealthRuntime } from "./credential-health-runtime";
import type { CredentialHealthRuntimeEvent } from "./credential-health-runtime";

const OAUTH_PROVIDERS = new Set(["google", "outlook"]);
const CALDAV_PROVIDERS = new Set(["caldav", "fastmail", "icloud"]);

interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
}

interface CoordinatedRefresherOptions {
  calendarId: string;
  database: BunSQLDatabase;
  oauthCredentialId: string;
  calendarAccountId: string;
  accessTokenExpiresAt: Date;
  refreshLockStore: RefreshLockStore | null;
  outboxRedis: Redis;
  rawRefresh: (refreshToken: string) => Promise<OAuthRefreshResult>;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
}

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const {
    accessTokenExpiresAt,
    database,
    oauthCredentialId,
    calendarAccountId,
    refreshLockStore,
    rawRefresh,
  } = options;

  const runtime = createCredentialHealthRuntime({
    accessTokenExpiresAt,
    calendarAccountId,
    isReauthRequiredError: (error) => isOAuthReauthRequiredError(error),
    markNeedsReauthentication: async () => {
      await database
        .update(calendarAccountsTable)
        .set({ needsReauthentication: true })
        .where(eq(calendarAccountsTable.id, calendarAccountId));
    },
    oauthCredentialId,
    persistRefreshedCredentials: async ({ accessToken, expiresAt, refreshToken }) => {
      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken,
          expiresAt,
          refreshToken,
        })
        .where(eq(oauthCredentialsTable.id, oauthCredentialId));
    },
    refreshAccessToken: rawRefresh,
    outboxStore: new RedisCommandOutboxStore({
      keyPrefix: "machine:outbox:credential-health",
      redis: options.outboxRedis,
    }),
    onRuntimeEvent: (event) => {
      if (options.onCredentialRuntimeEvent) {
        return options.onCredentialRuntimeEvent(options.calendarId, event);
      }
    },
  });

  return (refreshToken: string) =>
    runWithCredentialRefreshLock(
      oauthCredentialId,
      () => runtime.refresh(refreshToken),
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
  outboxRedis: Redis,
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void,
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
        calendarId,
        accessTokenExpiresAt: oauthCred.expiresAt,
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
        refreshLockStore,
        outboxRedis,
        rawRefresh: (refreshToken) => googleOAuth.refreshAccessToken(refreshToken),
        onCredentialRuntimeEvent,
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
        calendarId,
        accessTokenExpiresAt: oauthCred.expiresAt,
        database,
        oauthCredentialId: oauthCred.oauthCredentialId,
        calendarAccountId: accountId,
        refreshLockStore,
        outboxRedis,
        rawRefresh: (refreshToken) => microsoftOAuth.refreshAccessToken(refreshToken),
        onCredentialRuntimeEvent,
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
  outboxRedis: Redis;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
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
      options.outboxRedis,
      options.onCredentialRuntimeEvent,
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

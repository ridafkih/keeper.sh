import type { CalendarSyncProvider, RefreshLockStore } from "@keeper.sh/calendar";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import {
  createCredentialHealthRuntime,
  type CredentialHealthRuntimeEvent,
  RedisCommandOutboxStore,
} from "@keeper.sh/machine-orchestration";
import type Redis from "ioredis";
import {
  createGoogleOAuthService,
  createMicrosoftOAuthService,
  type OAuthRefreshResult,
  runWithCredentialRefreshLock,
  isOAuthReauthRequiredError,
  createGoogleSyncProvider,
  createOutlookSyncProvider,
  createCalDAVSyncProvider,
} from "@keeper.sh/calendar";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  ProviderResolutionStatus,
  hasOAuthProviderConfig,
  isCaldavProviderName,
  isOAuthProviderName,
  resolveProviderSupportStatus,
} from "./provider-resolution-policy";
import type {
  OAuthConfig,
  OAuthProviderName,
  ProviderResolutionStatus as ProviderResolutionStatusType,
} from "./provider-resolution-policy";

type ProviderResolutionOutcome =
  | { status: typeof ProviderResolutionStatus.RESOLVED; provider: CalendarSyncProvider }
  | { status: typeof ProviderResolutionStatus.UNSUPPORTED_PROVIDER }
  | { status: typeof ProviderResolutionStatus.MISCONFIGURED_PROVIDER }
  | { status: typeof ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS };

interface OAuthCredentialRecord {
  accessToken: string;
  expiresAt: Date;
  externalCalendarId: string | null;
  oauthCredentialId: string;
  refreshToken: string;
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

interface OAuthProviderBuildInput {
  accountId: string;
  calendarId: string;
  database: BunSQLDatabase;
  oauthConfig: OAuthConfig;
  oauthCredential: OAuthCredentialRecord;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
  outboxRedis: Redis;
  rateLimiter?: RedisRateLimiter;
  refreshLockStore: RefreshLockStore | null;
  signal?: AbortSignal;
  userId: string;
}

const resolvedProvider = (
  provider: CalendarSyncProvider,
): ProviderResolutionOutcome => ({
  status: ProviderResolutionStatus.RESOLVED,
  provider,
});

const unresolvedProvider = (
  status: Exclude<ProviderResolutionStatusType, typeof ProviderResolutionStatus.RESOLVED>,
): ProviderResolutionOutcome => ({ status });

const loadOAuthCredential = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<OAuthCredentialRecord | null> => {
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

  return oauthCred ?? null;
};

const createCoordinatedRefresher = (options: CoordinatedRefresherOptions) => {
  const {
    accessTokenExpiresAt,
    database,
    oauthCredentialId,
    calendarAccountId,
    refreshLockStore,
    rawRefresh,
  } = options;
  let envelopeSequence = 0;

  const runtime = createCredentialHealthRuntime({
    accessTokenExpiresAt,
    calendarAccountId,
    createEnvelope: (event) => {
      envelopeSequence += 1;
      return {
        actor: { id: "sync-refresh", type: "system" },
        event,
        id: `${oauthCredentialId}:${envelopeSequence}:${event.type}`,
        occurredAt: new Date().toISOString(),
      };
    },
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

const buildGoogleOAuthProvider = (
  input: OAuthProviderBuildInput,
): ProviderResolutionOutcome => {
  if (!hasOAuthProviderConfig("google", input.oauthConfig)) {
    return unresolvedProvider(ProviderResolutionStatus.MISCONFIGURED_PROVIDER);
  }
  if (!input.oauthCredential.externalCalendarId) {
    return unresolvedProvider(ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS);
  }

  const { googleClientId, googleClientSecret } = input.oauthConfig;
  if (!googleClientId || !googleClientSecret) {
    return unresolvedProvider(ProviderResolutionStatus.MISCONFIGURED_PROVIDER);
  }

  const googleOAuth = createGoogleOAuthService({
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  });

  return resolvedProvider(createGoogleSyncProvider({
    accessToken: input.oauthCredential.accessToken,
    refreshToken: input.oauthCredential.refreshToken,
    accessTokenExpiresAt: input.oauthCredential.expiresAt,
    externalCalendarId: input.oauthCredential.externalCalendarId,
    calendarId: input.calendarId,
    userId: input.userId,
    refreshAccessToken: createCoordinatedRefresher({
      calendarId: input.calendarId,
      accessTokenExpiresAt: input.oauthCredential.expiresAt,
      database: input.database,
      oauthCredentialId: input.oauthCredential.oauthCredentialId,
      calendarAccountId: input.accountId,
      refreshLockStore: input.refreshLockStore,
      outboxRedis: input.outboxRedis,
      rawRefresh: (refreshToken) => googleOAuth.refreshAccessToken(refreshToken),
      onCredentialRuntimeEvent: input.onCredentialRuntimeEvent,
    }),
    rateLimiter: input.rateLimiter,
    signal: input.signal,
  }));
};

const buildOutlookOAuthProvider = (
  input: OAuthProviderBuildInput,
): ProviderResolutionOutcome => {
  if (!hasOAuthProviderConfig("outlook", input.oauthConfig)) {
    return unresolvedProvider(ProviderResolutionStatus.MISCONFIGURED_PROVIDER);
  }
  if (!input.oauthCredential.externalCalendarId) {
    return unresolvedProvider(ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS);
  }

  const { microsoftClientId, microsoftClientSecret } = input.oauthConfig;
  if (!microsoftClientId || !microsoftClientSecret) {
    return unresolvedProvider(ProviderResolutionStatus.MISCONFIGURED_PROVIDER);
  }

  const microsoftOAuth = createMicrosoftOAuthService({
    clientId: microsoftClientId,
    clientSecret: microsoftClientSecret,
  });

  return resolvedProvider(createOutlookSyncProvider({
    accessToken: input.oauthCredential.accessToken,
    refreshToken: input.oauthCredential.refreshToken,
    accessTokenExpiresAt: input.oauthCredential.expiresAt,
    externalCalendarId: input.oauthCredential.externalCalendarId,
    calendarId: input.calendarId,
    userId: input.userId,
    refreshAccessToken: createCoordinatedRefresher({
      calendarId: input.calendarId,
      accessTokenExpiresAt: input.oauthCredential.expiresAt,
      database: input.database,
      oauthCredentialId: input.oauthCredential.oauthCredentialId,
      calendarAccountId: input.accountId,
      refreshLockStore: input.refreshLockStore,
      outboxRedis: input.outboxRedis,
      rawRefresh: (refreshToken) => microsoftOAuth.refreshAccessToken(refreshToken),
      onCredentialRuntimeEvent: input.onCredentialRuntimeEvent,
    }),
  }));
};

const OAUTH_PROVIDER_STRATEGY: Record<
  OAuthProviderName,
  (input: OAuthProviderBuildInput) => ProviderResolutionOutcome
> = {
  google: buildGoogleOAuthProvider,
  outlook: buildOutlookOAuthProvider,
};

interface ResolveOAuthProviderOptions {
  database: BunSQLDatabase;
  provider: string;
  calendarId: string;
  userId: string;
  accountId: string;
  oauthConfig: OAuthConfig;
  refreshLockStore: RefreshLockStore | null;
  outboxRedis: Redis;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
}

const resolveOAuthProvider = async (
  options: ResolveOAuthProviderOptions,
): Promise<ProviderResolutionOutcome> => {
  const {
    database,
    provider,
    calendarId,
    userId,
    accountId,
    oauthConfig,
    refreshLockStore,
    outboxRedis,
    onCredentialRuntimeEvent,
    rateLimiter,
    signal,
  } = options;

  if (!isOAuthProviderName(provider)) {
    return unresolvedProvider(ProviderResolutionStatus.UNSUPPORTED_PROVIDER);
  }

  const oauthCredential = await loadOAuthCredential(database, calendarId);
  if (!oauthCredential) {
    return unresolvedProvider(ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS);
  }

  const resolveOAuthStrategy = OAUTH_PROVIDER_STRATEGY[provider];
  return resolveOAuthStrategy({
    accountId,
    calendarId,
    database,
    oauthConfig,
    oauthCredential,
    onCredentialRuntimeEvent,
    outboxRedis,
    rateLimiter,
    refreshLockStore,
    signal,
    userId,
  });
};

const resolveCalDAVProvider = async (
  database: BunSQLDatabase,
  calendarId: string,
  encryptionKey: string,
): Promise<ProviderResolutionOutcome> => {
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
    return unresolvedProvider(ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS);
  }

  const password = decryptPassword(caldavCred.encryptedPassword, encryptionKey);

  return {
    status: ProviderResolutionStatus.RESOLVED,
    provider: createCalDAVSyncProvider({
      calendarUrl: caldavCred.calendarUrl ?? caldavCred.serverUrl,
      serverUrl: caldavCred.serverUrl,
      username: caldavCred.username,
      password,
    }),
  };
};

interface ResolveProviderOptions {
  database: BunSQLDatabase;
  provider: string;
  calendarId: string;
  userId: string;
  accountId: string;
  oauthConfig: OAuthConfig;
  encryptionKey?: string;
  refreshLockStore: RefreshLockStore | null;
  outboxRedis: Redis;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
}

const resolveSyncProviderOutcome = (options: ResolveProviderOptions): Promise<ProviderResolutionOutcome> => {
  if (isOAuthProviderName(options.provider)) {
    return resolveOAuthProvider({
      database: options.database,
      provider: options.provider,
      calendarId: options.calendarId,
      userId: options.userId,
      accountId: options.accountId,
      oauthConfig: options.oauthConfig,
      refreshLockStore: options.refreshLockStore,
      outboxRedis: options.outboxRedis,
      onCredentialRuntimeEvent: options.onCredentialRuntimeEvent,
      rateLimiter: options.rateLimiter,
      signal: options.signal,
    });
  }

  if (isCaldavProviderName(options.provider) && options.encryptionKey) {
    return resolveCalDAVProvider(
      options.database,
      options.calendarId,
      options.encryptionKey,
    );
  }

  return Promise.resolve(
    unresolvedProvider(resolveProviderSupportStatus(options.provider, options.encryptionKey)),
  );
};

const resolveSyncProvider = async (
  options: ResolveProviderOptions,
): Promise<CalendarSyncProvider | null> => {
  const outcome = await resolveSyncProviderOutcome(options);
  if (outcome.status !== ProviderResolutionStatus.RESOLVED) {
    return null;
  }
  return outcome.provider;
};

export {
  ProviderResolutionStatus,
  resolveSyncProvider,
  resolveSyncProviderOutcome,
};
export type {
  OAuthConfig,
  ProviderResolutionOutcome,
};

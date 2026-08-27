import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, count, eq, inArray, not, sql } from "drizzle-orm";
import { runWithCredentialRefreshLock } from "@keeper.sh/calendar";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/calendar/google";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/calendar/outlook";
import type { database as contextDatabase, oauthProviders as contextOAuthProviders } from "@/context";
import { spawnBackgroundJob } from "./background-task";
import { widelog } from "./logging";
import {
  createSourceCalendarInsertDependencies,
  insertSourceCalendars,
} from "./source-calendar-insert";

import { enqueuePushSync } from "./enqueue-push-sync";
import { registerAccountPushChannels } from "./push-notifications/register-account-channels";

const FIRST_RESULT_LIMIT = 1;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const MS_PER_SECOND = 1000;
const OAUTH_CALENDAR_TYPE = "oauth";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
type OAuthSourceDatabase = Pick<typeof contextDatabase, "insert" | "select" | "selectDistinct" | "update">;

class OAuthSourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

class DestinationNotFoundError extends Error {
  constructor() {
    super("Destination not found or not owned by user");
  }
}

class DestinationProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Destination is not a ${provider} account`);
  }
}

class DuplicateSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

interface OAuthCalendarSource {
  id: string;
  name: string;
  provider: string;
  email: string | null;
}

interface OAuthAccountWithCredentials {
  accountId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface OAuthSourceWithCredentials {
  credentialId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getUserOAuthSources = async (
  userId: string,
  provider: string,
): Promise<OAuthCalendarSource[]> => {
  const { database } = await import("@/context");
  const sources = await database
    .select({
      createdAt: calendarsTable.createdAt,
      email: oauthCredentialsTable.email,
      externalCalendarId: calendarsTable.externalCalendarId,
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .leftJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, OAUTH_CALENDAR_TYPE),
        eq(calendarAccountsTable.provider, provider),
        inArray(calendarsTable.id,
          database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable)
        ),
      ),
    );

  return sources.map((source) => ({
    email: source.email,
    id: source.id,
    name: source.name,
    provider: source.provider,
  }));
};

const getOAuthDestinationCredentials = async (
  userId: string,
  accountId: string,
  provider: string,
): Promise<OAuthAccountWithCredentials> => {
  const { database } = await import("@/context");
  const [result] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accountId: calendarAccountsTable.id,
      email: calendarAccountsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new DestinationNotFoundError();
  }

  if (result.provider !== provider) {
    throw new DestinationProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    accountId: result.accountId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

class SourceCredentialNotFoundError extends Error {
  constructor() {
    super("Source credential not found or not owned by user");
  }
}

class SourceCredentialProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Source credential is not a ${provider} account`);
  }
}

const getOAuthSourceCredentials = async (
  userId: string,
  credentialId: string,
  provider: string,
): Promise<OAuthSourceWithCredentials> => {
  const { database } = await import("@/context");
  const [result] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      credentialId: oauthCredentialsTable.id,
      email: oauthCredentialsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: oauthCredentialsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new SourceCredentialNotFoundError();
  }

  if (result.provider !== provider) {
    throw new SourceCredentialProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    credentialId: result.credentialId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

interface CreateOAuthSourceOptions {
  userId: string;
  externalCalendarId: string;
  name: string;
  provider: string;
  oauthCredentialId: string;
  providerAccountId?: string | null;
  excludeFocusTime?: boolean;
  excludeOutOfOffice?: boolean;
}

interface CreateOAuthSourceDependencies {
  adoptProviderAccountId: (
    options: { accountRowId: string; providerAccountId: string | null },
  ) => Promise<void>;
  canAddAccount: (userId: string, currentCount: number) => Promise<boolean>;
  countUserAccounts: (userId: string) => Promise<number>;
  createSource: (payload: {
    accountId: string;
    externalCalendarId: string;
    name: string;
    originalName: string;
    provider: string;
    userId: string;
    excludeFocusTime: boolean;
    excludeOutOfOffice: boolean;
  }) => Promise<{ id: string; name: string } | null>;
  createCalendarAccount: (payload: {
    displayName: string | null;
    email: string | null;
    oauthCredentialId: string;
    provider: string;
    providerAccountId: string | null;
    userId: string;
  }) => Promise<string | null>;
  findCredentialEmail: (
    userId: string,
    oauthCredentialId: string,
  ) => Promise<{ email: string | null; exists: boolean }>;
  findExistingAccountId: (options: FindOAuthAccountOptions) => Promise<string | null>;
  hasExistingCalendar: (options: {
    externalCalendarId: string;
    oauthCredentialId: string;
    userId: string;
  }) => Promise<boolean>;
  triggerSync: (userId: string, provider: string, accountId: string) => void;
}

const countUserAccountsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
): Promise<number> => {
  const [result] = await databaseClient
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const countUserAccounts = async (userId: string): Promise<number> => {
  const { database } = await import("@/context");
  return countUserAccountsWithDatabase(database, userId);
};

interface FindOAuthAccountOptions {
  userId: string;
  provider: string;
  oauthCredentialId: string;
  providerAccountId?: string | null;
}

const findOAuthAccountIdByProviderIdentity = async (
  databaseClient: OAuthSourceDatabase,
  options: FindOAuthAccountOptions,
): Promise<string | null> => {
  const { userId, provider, providerAccountId } = options;
  if (!providerAccountId) {
    return null;
  }

  const [existingAccount] = await databaseClient
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.accountId, providerAccountId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return existingAccount?.id ?? null;
};

const findOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: FindOAuthAccountOptions,
): Promise<string | null> => {
  const { userId, provider, oauthCredentialId } = options;

  const identityMatch = await findOAuthAccountIdByProviderIdentity(databaseClient, options);
  if (identityMatch) {
    return identityMatch;
  }

  const [existingAccount] = await databaseClient
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return existingAccount?.id ?? null;
};

const findOAuthAccountId = async (
  options: FindOAuthAccountOptions,
): Promise<string | null> => {
  const { database } = await import("@/context");
  return findOAuthAccountIdWithDatabase(database, options);
};

const storedProviderAccountIdIsPlaceholder = () =>
  sql`(${calendarAccountsTable.accountId} is null or ${calendarAccountsTable.accountId} = '' or ${calendarAccountsTable.accountId} = ${calendarAccountsTable.id}::text)`;

const adoptProviderAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: { accountRowId: string; providerAccountId: string | null },
): Promise<void> => {
  if (!options.providerAccountId) {
    return;
  }

  await databaseClient
    .update(calendarAccountsTable)
    .set({ accountId: options.providerAccountId })
    .where(
      and(
        eq(calendarAccountsTable.id, options.accountRowId),
        storedProviderAccountIdIsPlaceholder(),
      ),
    );
};

const findStoredProviderAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: { oauthCredentialId: string; provider: string; userId: string },
): Promise<string | null> => {
  const [storedAccount] = await databaseClient
    .select({ accountId: calendarAccountsTable.accountId })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, options.userId),
        eq(calendarAccountsTable.provider, options.provider),
        eq(calendarAccountsTable.oauthCredentialId, options.oauthCredentialId),
        not(storedProviderAccountIdIsPlaceholder()),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return storedAccount?.accountId ?? null;
};

const hasExistingOAuthCalendarWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: {
    externalCalendarId: string;
    oauthCredentialId: string;
    userId: string;
  },
): Promise<boolean> => {
  const { externalCalendarId, oauthCredentialId, userId } = options;

  const [existingCalendar] = await databaseClient
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.externalCalendarId, externalCalendarId),
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(existingCalendar);
};

const hasExistingOAuthCalendar = async (
  options: {
    externalCalendarId: string;
    oauthCredentialId: string;
    userId: string;
  },
): Promise<boolean> => {
  const { database } = await import("@/context");
  return hasExistingOAuthCalendarWithDatabase(database, options);
};

const createOAuthSourceRecordWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  payload: Parameters<CreateOAuthSourceDependencies["createSource"]>[0],
): Promise<{ id: string; name: string } | null> => {
  const [source] = await insertSourceCalendars(
    createSourceCalendarInsertDependencies(databaseClient),
    payload.userId,
    [{
      accountId: payload.accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      excludeFocusTime: payload.excludeFocusTime,
      excludeOutOfOffice: payload.excludeOutOfOffice,
      externalCalendarId: payload.externalCalendarId,
      name: payload.name,
      originalName: payload.originalName,
      userId: payload.userId,
    }],
  );

  if (!source) {
    return null;
  }

  return {
    id: source.id,
    name: source.name,
  };
};

interface OAuthSourceCredential {
  accessToken: string;
  email: string | null;
  expiresAt: Date;
  refreshToken: string;
}

const findCredentialWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  oauthCredentialId: string,
): Promise<OAuthSourceCredential | null> => {
  const [credential] = await databaseClient
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      email: oauthCredentialsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, oauthCredentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return credential ?? null;
};

const findCredentialEmailWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  oauthCredentialId: string,
): Promise<{ email: string | null; exists: boolean }> => {
  const credential = await findCredentialWithDatabase(databaseClient, userId, oauthCredentialId);

  return {
    email: credential?.email ?? null,
    exists: Boolean(credential),
  };
};

type OAuthSourceProvider = Pick<
  NonNullable<ReturnType<typeof contextOAuthProviders.getProvider>>,
  "fetchUserInfo" | "refreshAccessToken"
>;

const resolveCredentialAccessToken = async (
  provider: OAuthSourceProvider,
  oauthCredentialId: string,
  credential: OAuthSourceCredential,
): Promise<string> => {
  if (credential.expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return credential.accessToken;
  }

  const { database } = await import("@/context");

  const refreshed = await runWithCredentialRefreshLock(
    oauthCredentialId,
    async () => {
      const result = await provider.refreshAccessToken(credential.refreshToken);

      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken: result.access_token,
          expiresAt: new Date(Date.now() + result.expires_in * MS_PER_SECOND),
          refreshToken: result.refresh_token ?? credential.refreshToken,
        })
        .where(eq(oauthCredentialsTable.id, oauthCredentialId));

      return result;
    },
  );

  return refreshed.access_token;
};

const resolveProviderAccountId = async (
  providerId: string,
  oauthCredentialId: string,
  credential: OAuthSourceCredential,
): Promise<string | null> => {
  const { oauthProviders } = await import("@/context");
  const provider = oauthProviders.getProvider(providerId);

  if (!provider) {
    throw new Error(`No OAuth provider registered for ${providerId}`);
  }

  try {
    const accessToken = await resolveCredentialAccessToken(provider, oauthCredentialId, credential);
    const userInfo = await provider.fetchUserInfo(accessToken);

    if (!userInfo.id) {
      widelog.set("oauth_source.provider_account_id_resolution", "missing_id");
      return null;
    }

    return userInfo.id;
  } catch (error) {
    widelog.set("oauth_source.provider_account_id_resolution", "provider_failure");
    widelog.errorFields(error, {
      retriable: true,
      slug: "provider-account-id-unresolved",
    });
    return null;
  }
};

const createDefaultCreateOAuthSourceDependencies = (): CreateOAuthSourceDependencies => ({
  adoptProviderAccountId: async (options) => {
    const { database } = await import("@/context");
    await adoptProviderAccountIdWithDatabase(database, options);
  },
  canAddAccount: async (userId, currentCount) => {
    const { premiumService } = await import("@/context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createCalendarAccount: async ({
    displayName,
    email,
    oauthCredentialId,
    provider,
    providerAccountId,
    userId,
  }) => {
    const { database } = await import("@/context");
    const [insertedAccount] = await database
      .insert(calendarAccountsTable)
      .values({
        accountId: providerAccountId,
        authType: "oauth",
        displayName: email ?? displayName,
        email: email ?? displayName,
        oauthCredentialId,
        provider,
        userId,
      })
      .returning({ id: calendarAccountsTable.id });

    return insertedAccount?.id ?? null;
  },
  createSource: async (payload) => {
    const { database } = await import("@/context");
    return createOAuthSourceRecordWithDatabase(database, payload);
  },
  findCredentialEmail: async (userId, oauthCredentialId) => {
    const { database } = await import("@/context");
    return findCredentialEmailWithDatabase(database, userId, oauthCredentialId);
  },
  findExistingAccountId: findOAuthAccountId,
  hasExistingCalendar: hasExistingOAuthCalendar,
  triggerSync: (userId, provider, accountId) => {
    spawnBackgroundJob("oauth-source-push-enqueue", { userId, provider }, async () => {
      const { premiumService } = await import("@/context");
      const plan = await premiumService.getUserPlan(userId);
      if (!plan) {
        throw new Error("Unable to resolve user plan for sync enqueue");
      }
      await enqueuePushSync(userId, plan);
    });
    spawnBackgroundJob("oauth-source-push-register", { accountId, provider, userId }, () =>
      registerAccountPushChannels(accountId));
  },
});

const createOAuthSourceWithDependencies = async (
  options: CreateOAuthSourceOptions,
  dependencies: CreateOAuthSourceDependencies,
): Promise<OAuthCalendarSource> => {
  const {
    userId,
    externalCalendarId,
    name,
    provider,
    oauthCredentialId,
    providerAccountId = null,
    excludeFocusTime = false,
    excludeOutOfOffice = false,
  } = options;

  const credential = await dependencies.findCredentialEmail(userId, oauthCredentialId);

  if (!credential.exists) {
    throw new Error("Source credential not found");
  }

  const existingAccountId = await dependencies.findExistingAccountId({
    oauthCredentialId,
    provider,
    providerAccountId,
    userId,
  });

  const existingCalendar = await dependencies.hasExistingCalendar({
    externalCalendarId,
    oauthCredentialId,
    userId,
  });

  if (existingCalendar) {
    throw new DuplicateSourceError();
  }

  let accountId = existingAccountId;

  if (accountId) {
    await dependencies.adoptProviderAccountId({ accountRowId: accountId, providerAccountId });
  }

  if (!accountId) {
    const existingAccountCount = await dependencies.countUserAccounts(userId);
    const allowed = await dependencies.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      throw new OAuthSourceLimitError();
    }

    const createdAccountId = await dependencies.createCalendarAccount({
      displayName: credential.email,
      email: credential.email,
      oauthCredentialId,
      provider,
      providerAccountId,
      userId,
    });

    if (!createdAccountId) {
      throw new Error("Failed to create calendar account");
    }

    accountId = createdAccountId;
  }

  const source = await dependencies.createSource({
    accountId,
    excludeFocusTime,
    excludeOutOfOffice,
    externalCalendarId,
    name,
    originalName: name,
    provider,
    userId,
  });

  if (!source) {
    throw new Error("Failed to create OAuth calendar source");
  }

  dependencies.triggerSync(userId, provider, accountId);

  return {
    email: credential.email,
    id: source.id,
    name: source.name,
    provider,
  };
};

const createOAuthSource = async (
  options: CreateOAuthSourceOptions,
): Promise<OAuthCalendarSource> => {
  const { database } = await import("@/context");

  const snapshot = await database.transaction(async (transaction) => ({
    credential: await findCredentialWithDatabase(
      transaction,
      options.userId,
      options.oauthCredentialId,
    ),
    storedProviderAccountId: await findStoredProviderAccountIdWithDatabase(transaction, {
      oauthCredentialId: options.oauthCredentialId,
      provider: options.provider,
      userId: options.userId,
    }),
  }));

  const { credential } = snapshot;

  if (!credential) {
    throw new Error("Source credential not found");
  }

  const providerAccountId = snapshot.storedProviderAccountId
    ?? await resolveProviderAccountId(options.provider, options.oauthCredentialId, credential);

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    const dependencies = createDefaultCreateOAuthSourceDependencies();

    return createOAuthSourceWithDependencies({ ...options, providerAccountId }, {
      ...dependencies,
      adoptProviderAccountId: (accountOptions) =>
        adoptProviderAccountIdWithDatabase(tx, accountOptions),
      createSource: (payload) => createOAuthSourceRecordWithDatabase(tx, payload),
      countUserAccounts: (userId) => countUserAccountsWithDatabase(tx, userId),
      createCalendarAccount: async (payload) => {
        const [insertedAccount] = await tx
          .insert(calendarAccountsTable)
          .values({
            accountId: payload.providerAccountId,
            authType: "oauth",
            displayName: payload.email ?? payload.displayName,
            email: payload.email ?? payload.displayName,
            id: crypto.randomUUID(),
            oauthCredentialId: payload.oauthCredentialId,
            provider: payload.provider,
            userId: payload.userId,
          })
          .returning({ id: calendarAccountsTable.id });
        return insertedAccount?.id ?? null;
      },
      findCredentialEmail: () =>
        Promise.resolve({ email: credential.email, exists: true }),
      findExistingAccountId: (accountOptions) => findOAuthAccountIdWithDatabase(tx, accountOptions),
      hasExistingCalendar: (calendarOptions) => hasExistingOAuthCalendarWithDatabase(tx, calendarOptions),
    });
  });
};

interface ImportOAuthAccountDependencies {
  canAddAccount: (userId: string, currentCount: number) => Promise<boolean>;
  countUserAccounts: (userId: string) => Promise<number>;
  createAccountId: (
    options: Pick<
      ImportOAuthAccountOptions,
      "userId" | "provider" | "oauthCredentialId" | "email" | "providerAccountId"
    >,
  ) => Promise<string>;
  adoptProviderAccountId: (
    options: { accountRowId: string; providerAccountId: string | null },
  ) => Promise<void>;
  findExistingAccountId: (options: FindOAuthAccountOptions) => Promise<string | null>;
  getUnimportedExternalCalendars: (
    userId: string,
    accountId: string,
    externalCalendars: ExternalCalendar[],
  ) => Promise<ExternalCalendar[]>;
  insertCalendars: (
    userId: string,
    accountId: string,
    calendars: ExternalCalendar[],
  ) => Promise<void>;
  listCalendars: (provider: string, accessToken: string, ownerEmail: string | null) => Promise<ExternalCalendar[]>;
  triggerSync: (userId: string, provider: string, accountId: string) => void;
}

const createDefaultImportOAuthAccountDependencies = (): ImportOAuthAccountDependencies => ({
  adoptProviderAccountId: async (options) => {
    const { database } = await import("@/context");
    await adoptProviderAccountIdWithDatabase(database, options);
  },
  canAddAccount: async (userId, currentCount) => {
    const { premiumService } = await import("@/context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createAccountId: async ({ userId, provider, oauthCredentialId, email, providerAccountId }) => {
    const { database } = await import("@/context");
    const [insertedAccount] = await database
      .insert(calendarAccountsTable)
      .values({
        accountId: providerAccountId,
        authType: "oauth",
        displayName: email,
        email,
        oauthCredentialId,
        provider,
        userId,
      })
      .returning({ id: calendarAccountsTable.id });

    if (!insertedAccount?.id) {
      throw new Error("Failed to find or create calendar account");
    }

    return insertedAccount.id;
  },
  findExistingAccountId: findOAuthAccountId,
  getUnimportedExternalCalendars: async (userId, accountId, externalCalendars) => {
    const { database } = await import("@/context");
    const existingCalendars = await database
      .select({ externalCalendarId: calendarsTable.externalCalendarId })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.accountId, accountId),
          eq(calendarsTable.userId, userId),
        ),
      );

    const existingExternalIds = new Set(
      existingCalendars.map((calendar) => calendar.externalCalendarId),
    );

    return externalCalendars.filter(
      (externalCalendar) => !existingExternalIds.has(externalCalendar.externalId),
    );
  },
  insertCalendars: async (userId, accountId, calendars) => {
    if (calendars.length === 0) {
      return;
    }

    const { database } = await import("@/context");
    await insertSourceCalendars(
      createSourceCalendarInsertDependencies(database),
      userId,
      calendars.map((calendar) => ({
        accountId,
        calendarType: OAUTH_CALENDAR_TYPE,
        capabilities: ["pull", "push"],
        externalCalendarId: calendar.externalId,
        name: calendar.name,
        originalName: calendar.name,
        userId,
      })),
    );
  },
  listCalendars: async (provider, accessToken, ownerEmail) => {
    try {
      if (provider === "google") {
        const calendars = await listGoogleCalendars(accessToken);
        return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.summary }));
      }
      if (provider === "outlook") {
        const calendars = await listOutlookCalendars(accessToken, { ownerEmail });
        return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.name }));
      }
      throw new Error(`No calendar listing support for provider: ${provider}`);
    } catch (error) {
      if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
        return [];
      }
      throw error;
    }
  },
  triggerSync: (userId, provider, accountId) => {
    spawnBackgroundJob("oauth-account-import-push-enqueue", { userId, provider }, async () => {
      const { premiumService } = await import("@/context");
      const plan = await premiumService.getUserPlan(userId);
      if (!plan) {
        throw new Error("Unable to resolve user plan for sync enqueue");
      }
      await enqueuePushSync(userId, plan);
    });
    spawnBackgroundJob("oauth-account-import-push-register", { accountId, provider, userId }, () =>
      registerAccountPushChannels(accountId));
  },
});

const importOAuthAccountCalendarsWithDependencies = async (
  options: ImportOAuthAccountOptions,
  dependencies: ImportOAuthAccountDependencies,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, accessToken, email, providerAccountId } = options;

  const existingAccountId = await dependencies.findExistingAccountId({
    oauthCredentialId,
    provider,
    providerAccountId,
    userId,
  });
  let accountId = existingAccountId;

  if (accountId) {
    await dependencies.adoptProviderAccountId({ accountRowId: accountId, providerAccountId });
  }

  if (!accountId) {
    const existingAccountCount = await dependencies.countUserAccounts(userId);
    const allowed = await dependencies.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      throw new OAuthSourceLimitError();
    }

    accountId = await dependencies.createAccountId({
      email,
      oauthCredentialId,
      provider,
      providerAccountId,
      userId,
    });
  }

  const externalCalendars = await dependencies.listCalendars(provider, accessToken, email);
  const newCalendars = await dependencies.getUnimportedExternalCalendars(
    userId,
    accountId,
    externalCalendars,
  );

  if (newCalendars.length === 0) {
    return accountId;
  }

  await dependencies.insertCalendars(userId, accountId, newCalendars);
  dependencies.triggerSync(userId, provider, accountId);

  return accountId;
};

interface ExternalCalendar {
  externalId: string;
  name: string;
}

interface ImportOAuthAccountOptions {
  userId: string;
  provider: string;
  oauthCredentialId: string;
  accessToken: string;
  email: string | null;
  providerAccountId: string | null;
}

const createOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: Pick<
    ImportOAuthAccountOptions,
    "userId" | "provider" | "oauthCredentialId" | "email" | "providerAccountId"
  >,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, email, providerAccountId } = options;

  const [insertedAccount] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      accountId: providerAccountId,
      authType: "oauth",
      displayName: email,
      email,
      oauthCredentialId,
      provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  if (!insertedAccount?.id) {
    throw new Error("Failed to find or create calendar account");
  }

  return insertedAccount.id;
};

const getUnimportedExternalCalendarsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  accountId: string,
  externalCalendars: ExternalCalendar[],
): Promise<ExternalCalendar[]> => {
  const existingCalendars = await databaseClient
    .select({ externalCalendarId: calendarsTable.externalCalendarId })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.accountId, accountId),
        eq(calendarsTable.userId, userId),
      ),
    );

  const existingExternalIds = new Set(
    existingCalendars.map((calendar) => calendar.externalCalendarId),
  );

  return externalCalendars.filter(
    (externalCalendar) => !existingExternalIds.has(externalCalendar.externalId),
  );
};

const insertOAuthCalendarsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  accountId: string,
  calendars: ExternalCalendar[],
): Promise<void> => {
  if (calendars.length === 0) {
    return;
  }

  await insertSourceCalendars(
    createSourceCalendarInsertDependencies(databaseClient),
    userId,
    calendars.map((calendar) => ({
      accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      externalCalendarId: calendar.externalId,
      name: calendar.name,
      originalName: calendar.name,
      userId,
    })),
  );
};

const importOAuthAccountCalendars = async (
  options: ImportOAuthAccountOptions,
): Promise<string> => {
  const { database, premiumService } = await import("@/context");

  const dependencies = createDefaultImportOAuthAccountDependencies();

  const plan = await premiumService.getUserPlan(options.userId);
  const externalCalendars = await dependencies.listCalendars(options.provider, options.accessToken, options.email);

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    return importOAuthAccountCalendarsWithDependencies(options, {
      ...dependencies,
      adoptProviderAccountId: (accountOptions) =>
        adoptProviderAccountIdWithDatabase(tx, accountOptions),
      canAddAccount: (_userId, currentCount) =>
        Promise.resolve(currentCount < premiumService.getAccountLimit(plan)),
      listCalendars: () => Promise.resolve(externalCalendars),
      countUserAccounts: (userId) => countUserAccountsWithDatabase(tx, userId),
      createAccountId: (accountOptions) => createOAuthAccountIdWithDatabase(tx, accountOptions),
      findExistingAccountId: (accountOptions) => findOAuthAccountIdWithDatabase(tx, accountOptions),
      getUnimportedExternalCalendars: (userId, accountId, calendars) =>
        getUnimportedExternalCalendarsWithDatabase(tx, userId, accountId, calendars),
      insertCalendars: (userId, accountId, calendars) =>
        insertOAuthCalendarsWithDatabase(tx, userId, accountId, calendars),
    });
  });
};

export {
  OAuthSourceLimitError,
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  getUserOAuthSources,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
  createOAuthSource,
  createOAuthSourceWithDependencies,
  createOAuthAccountIdWithDatabase,
  findOAuthAccountIdWithDatabase,
  importOAuthAccountCalendars,
  importOAuthAccountCalendarsWithDependencies,
};

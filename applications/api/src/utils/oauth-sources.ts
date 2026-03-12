import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/provider-google-calendar";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/provider-outlook";
import type { database as contextDatabase } from "../context";
import { spawnBackgroundJob } from "./background-task";
import { getSourceProvider } from "@keeper.sh/provider-registry/server";
import { applySourceSyncDefaults } from "./source-sync-defaults";

import { triggerDestinationSync } from "./sync";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_CALENDAR_TYPE = "oauth";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
type OAuthSourceDatabase = Pick<typeof contextDatabase, "insert" | "select" | "selectDistinct">;

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
  const { database } = await import("../context");
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

const verifyOAuthSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const { database } = await import("../context");
  const [source] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, OAUTH_CALENDAR_TYPE),
        inArray(calendarsTable.id,
          database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable)
        ),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

const getOAuthDestinationCredentials = async (
  userId: string,
  accountId: string,
  provider: string,
): Promise<OAuthAccountWithCredentials> => {
  const { database } = await import("../context");
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
  const { database } = await import("../context");
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
  excludeFocusTime?: boolean;
  excludeOutOfOffice?: boolean;
  excludeWorkingLocation?: boolean;
}

interface CreateOAuthSourceDependencies {
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
    excludeWorkingLocation: boolean;
  }) => Promise<{ id: string; name: string } | null>;
  createCalendarAccount: (payload: {
    displayName: string | null;
    email: string | null;
    oauthCredentialId: string;
    provider: string;
    userId: string;
  }) => Promise<string | null>;
  findCredentialEmail: (
    userId: string,
    oauthCredentialId: string,
  ) => Promise<{ email: string | null; exists: boolean }>;
  findExistingAccountId: (options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  }) => Promise<string | null>;
  hasExistingCalendar: (options: {
    externalCalendarId: string;
    oauthCredentialId: string;
    userId: string;
  }) => Promise<boolean>;
  triggerSync: (userId: string, provider: string) => void;
}

const countUserAccountsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
): Promise<number> => {
  const accounts = await databaseClient
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return accounts.length;
};

const countUserAccounts = async (userId: string): Promise<number> => {
  const { database } = await import("../context");
  return countUserAccountsWithDatabase(database, userId);
};

const findOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  },
): Promise<string | null> => {
  const { userId, provider, oauthCredentialId } = options;

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
  options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  },
): Promise<string | null> => {
  const { database } = await import("../context");
  return findOAuthAccountIdWithDatabase(database, options);
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
  const { database } = await import("../context");
  return hasExistingOAuthCalendarWithDatabase(database, options);
};

const syncOAuthSourcesByProvider = async (providerId: string): Promise<void> => {
  const { database, oauthProviders, refreshLockStore } = await import("../context");
  const sourceProvider = getSourceProvider(providerId, {
    database,
    oauthProviders,
    refreshLockStore,
  });
  if (!sourceProvider) {
    return;
  }
  await sourceProvider.syncAllSources();
};

const createOAuthSourceRecordWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  payload: Parameters<CreateOAuthSourceDependencies["createSource"]>[0],
): Promise<{ id: string; name: string } | null> => {
  const [source] = await databaseClient
    .insert(calendarsTable)
    .values(applySourceSyncDefaults({
      accountId: payload.accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      excludeFocusTime: payload.excludeFocusTime,
      excludeOutOfOffice: payload.excludeOutOfOffice,
      excludeWorkingLocation: payload.excludeWorkingLocation,
      externalCalendarId: payload.externalCalendarId,
      name: payload.name,
      originalName: payload.originalName,
      userId: payload.userId,
    }))
    .returning();

  if (!source) {
    return null;
  }

  return {
    id: source.id,
    name: source.name,
  };
};

const findCredentialEmailWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  oauthCredentialId: string,
): Promise<{ email: string | null; exists: boolean }> => {
  const [credential] = await databaseClient
    .select({ email: oauthCredentialsTable.email })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, oauthCredentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return {
    email: credential?.email ?? null,
    exists: Boolean(credential),
  };
};

const createDefaultCreateOAuthSourceDependencies = (): CreateOAuthSourceDependencies => ({
  canAddAccount: async (userId, currentCount) => {
    const { premiumService } = await import("../context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createCalendarAccount: async ({ displayName, email, oauthCredentialId, provider, userId }) => {
    const { database } = await import("../context");
    return createOAuthAccountIdWithDatabase(database, {
      email: email ?? displayName,
      oauthCredentialId,
      provider,
      userId,
    });
  },
  createSource: async (payload) => {
    const { database } = await import("../context");
    return createOAuthSourceRecordWithDatabase(database, payload);
  },
  findCredentialEmail: async (userId, oauthCredentialId) => {
    const { database } = await import("../context");
    return findCredentialEmailWithDatabase(database, userId, oauthCredentialId);
  },
  findExistingAccountId: findOAuthAccountId,
  hasExistingCalendar: hasExistingOAuthCalendar,
  triggerSync: (userId, provider) => {
    spawnBackgroundJob("oauth-source-sync", { userId, provider }, async () => {
      await syncOAuthSourcesByProvider(provider);
      triggerDestinationSync(userId);
    });
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
    excludeFocusTime = false,
    excludeOutOfOffice = false,
    excludeWorkingLocation = false,
  } = options;

  const credential = await dependencies.findCredentialEmail(userId, oauthCredentialId);

  if (!credential.exists) {
    throw new Error("Source credential not found");
  }

  const existingAccountId = await dependencies.findExistingAccountId({
    oauthCredentialId,
    provider,
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
    excludeWorkingLocation,
    externalCalendarId,
    name,
    originalName: name,
    provider,
    userId,
  });

  if (!source) {
    throw new Error("Failed to create OAuth calendar source");
  }

  dependencies.triggerSync(userId, provider);

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
  const { database } = await import("../context");

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    const dependencies = createDefaultCreateOAuthSourceDependencies();

    return createOAuthSourceWithDependencies(options, {
      ...dependencies,
      createSource: (payload) => createOAuthSourceRecordWithDatabase(tx, payload),
      countUserAccounts: (userId) => countUserAccountsWithDatabase(tx, userId),
      createCalendarAccount: ({ displayName, email, oauthCredentialId, provider, userId }) =>
        createOAuthAccountIdWithDatabase(tx, {
          email: email ?? displayName,
          oauthCredentialId,
          provider,
          userId,
        }),
      findCredentialEmail: (userId, oauthCredentialId) =>
        findCredentialEmailWithDatabase(tx, userId, oauthCredentialId),
      findExistingAccountId: (accountOptions) => findOAuthAccountIdWithDatabase(tx, accountOptions),
      hasExistingCalendar: (calendarOptions) => hasExistingOAuthCalendarWithDatabase(tx, calendarOptions),
    });
  });
};

interface ImportOAuthAccountDependencies {
  canAddAccount: (userId: string, currentCount: number) => Promise<boolean>;
  countUserAccounts: (userId: string) => Promise<number>;
  createAccountId: (
    options: Pick<ImportOAuthAccountOptions, "userId" | "provider" | "oauthCredentialId" | "email">,
  ) => Promise<string>;
  findExistingAccountId: (options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  }) => Promise<string | null>;
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
  listCalendars: (provider: string, accessToken: string) => Promise<ExternalCalendar[]>;
  triggerSync: (userId: string, provider: string) => void;
}

const createDefaultImportOAuthAccountDependencies = (): ImportOAuthAccountDependencies => ({
  canAddAccount: async (userId, currentCount) => {
    const { premiumService } = await import("../context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createAccountId: createOAuthAccountId,
  findExistingAccountId: findOAuthAccountId,
  getUnimportedExternalCalendars,
  insertCalendars: insertOAuthCalendars,
  listCalendars: (provider, accessToken) => {
    const listCalendars = listProviderCalendars[provider];
    if (!listCalendars) {
      throw new Error(`No calendar listing support for provider: ${provider}`);
    }

    return listCalendars(accessToken);
  },
  triggerSync: triggerOAuthImportSync,
});

const importOAuthAccountCalendarsWithDependencies = async (
  options: ImportOAuthAccountOptions,
  dependencies: ImportOAuthAccountDependencies,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, accessToken, email } = options;

  const existingAccountId = await dependencies.findExistingAccountId({
    oauthCredentialId,
    provider,
    userId,
  });
  let accountId = existingAccountId;

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
      userId,
    });
  }

  const externalCalendars = await dependencies.listCalendars(provider, accessToken);
  const newCalendars = await dependencies.getUnimportedExternalCalendars(
    userId,
    accountId,
    externalCalendars,
  );

  if (newCalendars.length === 0) {
    return accountId;
  }

  await dependencies.insertCalendars(userId, accountId, newCalendars);
  dependencies.triggerSync(userId, provider);

  return accountId;
};

interface ExternalCalendar {
  externalId: string;
  name: string;
}

const listProviderCalendars: Record<string, (accessToken: string) => Promise<ExternalCalendar[]>> = {
  google: async (accessToken) => {
    const calendars = await listGoogleCalendars(accessToken);
    return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.summary }));
  },
  outlook: async (accessToken) => {
    const calendars = await listOutlookCalendars(accessToken);
    return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.name }));
  },
};

interface ImportOAuthAccountOptions {
  userId: string;
  provider: string;
  oauthCredentialId: string;
  accessToken: string;
  email: string | null;
}

const createOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: Pick<ImportOAuthAccountOptions, "userId" | "provider" | "oauthCredentialId" | "email">,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, email } = options;

  const [insertedAccount] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
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

const createOAuthAccountId = async (
  options: Pick<ImportOAuthAccountOptions, "userId" | "provider" | "oauthCredentialId" | "email">,
): Promise<string> => {
  const { database } = await import("../context");
  return createOAuthAccountIdWithDatabase(database, options);
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

const getUnimportedExternalCalendars = async (
  userId: string,
  accountId: string,
  externalCalendars: ExternalCalendar[],
): Promise<ExternalCalendar[]> => {
  const { database } = await import("../context");
  return getUnimportedExternalCalendarsWithDatabase(database, userId, accountId, externalCalendars);
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

  await databaseClient
    .insert(calendarsTable)
    .values(
      calendars.map((calendar) => applySourceSyncDefaults({
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

const insertOAuthCalendars = async (
  userId: string,
  accountId: string,
  calendars: ExternalCalendar[],
): Promise<void> => {
  const { database } = await import("../context");
  await insertOAuthCalendarsWithDatabase(database, userId, accountId, calendars);
};

const triggerOAuthImportSync = (userId: string, provider: string): void => {
  spawnBackgroundJob("oauth-account-import", { userId, provider }, async () => {
    await syncOAuthSourcesByProvider(provider);
    triggerDestinationSync(userId);
  });
};

const importOAuthAccountCalendars = async (
  options: ImportOAuthAccountOptions,
): Promise<string> => {
  const { database } = await import("../context");

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    const dependencies = createDefaultImportOAuthAccountDependencies();

    return importOAuthAccountCalendarsWithDependencies(options, {
      ...dependencies,
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
  verifyOAuthSourceOwnership,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
  createOAuthSource,
  createOAuthSourceWithDependencies,
  importOAuthAccountCalendars,
  importOAuthAccountCalendarsWithDependencies,
};

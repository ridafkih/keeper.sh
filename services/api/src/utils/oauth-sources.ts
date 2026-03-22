import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  listGoogleUserCalendars as listGoogleCalendars,
  listOutlookUserCalendars as listOutlookCalendars,
} from "@keeper.sh/calendar";
import { createSourceProvisioningDispatcher } from "@keeper.sh/machine-orchestration";
import { TransitionPolicy } from "@keeper.sh/state-machines";
import {
  countUserAccountsWithDatabase,
  createOAuthAccountIdWithDatabase,
  createOAuthSourceRecordWithDatabase,
  findCredentialEmailWithDatabase,
  findOAuthAccountIdWithDatabase,
  getUnimportedExternalCalendarsWithDatabase,
  hasExistingOAuthCalendarWithDatabase,
  insertOAuthCalendarsWithDatabase,
  type ExternalCalendar,
  type OAuthSourceDatabase,
} from "./oauth-source-repository";
import { triggerOAuthSourceSync } from "./oauth-source-sync-trigger";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_CALENDAR_TYPE = "oauth";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
const SUPPORTED_OAUTH_PROVIDER_IDS = new Set(["google", "outlook"]);
type OAuthProviderId = "google" | "outlook";

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

class UnsupportedOAuthProviderError extends Error {
  constructor(operation: "source_create" | "account_import" | "calendar_listing", provider: string) {
    super(`Unsupported OAuth provider for ${operation}: ${provider}`);
  }
}

class OAuthSourceAccountCreateError extends Error {
  constructor() {
    super("Failed to create calendar account");
  }
}

class OAuthSourceCreateError extends Error {
  constructor() {
    super("Failed to create OAuth calendar source");
  }
}

class OAuthSourceProvisioningInvariantError extends Error {
  constructor() {
    super("Invariant violated: source provisioning did not request bootstrap sync");
  }
}

class OAuthImportAccountCreateError extends Error {
  constructor() {
    super("Failed to find or create calendar account");
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

const isOAuthProviderId = (provider: string): provider is OAuthProviderId =>
  SUPPORTED_OAUTH_PROVIDER_IDS.has(provider);

function assertOAuthProviderId(
  operation: "source_create" | "account_import" | "calendar_listing",
  provider: string,
): asserts provider is OAuthProviderId {
  if (!isOAuthProviderId(provider)) {
    throw new UnsupportedOAuthProviderError(operation, provider);
  }
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

const verifyOAuthSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const { database } = await import("@/context");
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

const countUserAccounts = async (userId: string): Promise<number> => {
  const { database } = await import("@/context");
  return countUserAccountsWithDatabase(database, userId);
};

const findOAuthAccountId = async (
  options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  },
): Promise<string | null> => {
  const { database } = await import("@/context");
  return findOAuthAccountIdWithDatabase(database, options);
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

const createDefaultCreateOAuthSourceDependencies = (): CreateOAuthSourceDependencies => ({
  canAddAccount: async (userId, currentCount) => {
    const { premiumService } = await import("@/context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createCalendarAccount: async ({ displayName, email, oauthCredentialId, provider, userId }) => {
    const { database } = await import("@/context");
    const [insertedAccount] = await database
      .insert(calendarAccountsTable)
      .values({
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
  triggerSync: (userId, provider) => {
    triggerOAuthSourceSync({ jobName: "oauth-source-sync", provider, userId });
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
  assertOAuthProviderId("source_create", provider);
  const requestId = crypto.randomUUID();
  const provisioningDispatcher = createSourceProvisioningDispatcher({
    actorId: "api-oauth-sources",
    mode: "create_single",
    provider,
    requestId,
    transitionPolicy: TransitionPolicy.REJECT,
    userId,
  });
  const dispatchProvisioningEvent = provisioningDispatcher.dispatch;

  const credential = await dependencies.findCredentialEmail(userId, oauthCredentialId);

  if (!credential.exists) {
    dispatchProvisioningEvent({
      reason: "invalid_source",
      type: "VALIDATION_FAILED",
    });
    throw new SourceCredentialNotFoundError();
  }
  dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });

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
    dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
    dispatchProvisioningEvent({ type: "DUPLICATE_DETECTED" });
    throw new DuplicateSourceError();
  }

  if (!existingAccountId) {
    const existingAccountCount = await dependencies.countUserAccounts(userId);
    const allowed = await dependencies.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      dispatchProvisioningEvent({ type: "QUOTA_DENIED" });
      throw new OAuthSourceLimitError();
    }
  }

  dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
  dispatchProvisioningEvent({ type: "DEDUPLICATION_PASSED" });

  const accountId = existingAccountId ?? await dependencies.createCalendarAccount({
    displayName: credential.email,
    email: credential.email,
    oauthCredentialId,
    provider,
    userId,
  });

  if (!accountId) {
    throw new OAuthSourceAccountCreateError();
  }
  if (existingAccountId) {
    dispatchProvisioningEvent({ accountId, type: "ACCOUNT_REUSED" });
  } else {
    dispatchProvisioningEvent({ accountId, type: "ACCOUNT_CREATED" });
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
    throw new OAuthSourceCreateError();
  }
  dispatchProvisioningEvent({
    sourceIds: [source.id],
    type: "SOURCE_CREATED",
  });
  const completionTransition = dispatchProvisioningEvent({
    mode: "create_single",
    sourceIds: [source.id],
    type: "BOOTSTRAP_SYNC_TRIGGERED",
  });
  const bootstrapRequested = completionTransition.outputs.some(
    (output) => output.type === "BOOTSTRAP_REQUESTED",
  );
  if (!bootstrapRequested) {
    throw new OAuthSourceProvisioningInvariantError();
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
  const { database } = await import("@/context");

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    const dependencies = createDefaultCreateOAuthSourceDependencies();

    return createOAuthSourceWithDependencies(options, {
      ...dependencies,
      createSource: (payload) => createOAuthSourceRecordWithDatabase(tx, payload),
      countUserAccounts: (userId) => countUserAccountsWithDatabase(tx, userId),
      createCalendarAccount: async ({ displayName, email, oauthCredentialId, provider, userId }) => {
        const [insertedAccount] = await tx
          .insert(calendarAccountsTable)
          .values({
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
    const { premiumService } = await import("@/context");
    return premiumService.canAddAccount(userId, currentCount);
  },
  countUserAccounts,
  createAccountId: async ({ userId, provider, oauthCredentialId, email }) => {
    const { database } = await import("@/context");
    const accountId = await createOAuthAccountIdWithDatabase(database, {
      email,
      oauthCredentialId,
      provider,
      userId,
    });
    if (!accountId) {
      throw new OAuthImportAccountCreateError();
    }
    return accountId;
  },
  findExistingAccountId: findOAuthAccountId,
  getUnimportedExternalCalendars: async (userId, accountId, externalCalendars) => {
    const { database } = await import("@/context");
    return getUnimportedExternalCalendarsWithDatabase(
      database,
      userId,
      accountId,
      externalCalendars,
    );
  },
  insertCalendars: async (userId, accountId, calendars) => {
    const { database } = await import("@/context");
    return insertOAuthCalendarsWithDatabase(database, userId, accountId, calendars);
  },
  listCalendars: async (provider, accessToken) => {
    assertOAuthProviderId("calendar_listing", provider);
    try {
      if (provider === "google") {
        const calendars = await listGoogleCalendars(accessToken);
        return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.summary }));
      }
      const calendars = await listOutlookCalendars(accessToken);
      return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.name }));
    } catch (error) {
      if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
        return [];
      }
      throw error;
    }
  },
  triggerSync: (userId, provider) => {
    triggerOAuthSourceSync({ jobName: "oauth-account-import", provider, userId });
  },
});

const importOAuthAccountCalendarsWithDependencies = async (
  options: ImportOAuthAccountOptions,
  dependencies: ImportOAuthAccountDependencies,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, accessToken, email } = options;
  assertOAuthProviderId("account_import", provider);
  const requestId = crypto.randomUUID();
  const provisioningDispatcher = createSourceProvisioningDispatcher({
    actorId: "api-oauth-sources",
    mode: "import_bulk",
    provider,
    requestId,
    transitionPolicy: TransitionPolicy.REJECT,
    userId,
  });
  const dispatchProvisioningEvent = provisioningDispatcher.dispatch;

  const existingAccountId = await dependencies.findExistingAccountId({
    oauthCredentialId,
    provider,
    userId,
  });
  dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });
  if (!existingAccountId) {
    const existingAccountCount = await dependencies.countUserAccounts(userId);
    const allowed = await dependencies.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      dispatchProvisioningEvent({ type: "QUOTA_DENIED" });
      throw new OAuthSourceLimitError();
    }
  }
  dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
  dispatchProvisioningEvent({ type: "DEDUPLICATION_PASSED" });

  const accountId = existingAccountId ?? await dependencies.createAccountId({
    email,
    oauthCredentialId,
    provider,
    userId,
  });
  if (existingAccountId) {
    dispatchProvisioningEvent({ accountId, type: "ACCOUNT_REUSED" });
  } else {
    dispatchProvisioningEvent({ accountId, type: "ACCOUNT_CREATED" });
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
  const sourceIds = newCalendars.map((calendar) => calendar.externalId);
  dispatchProvisioningEvent({
    sourceIds,
    type: "SOURCE_CREATED",
  });
  const completionTransition = dispatchProvisioningEvent({
    mode: "import_bulk",
    sourceIds,
    type: "BOOTSTRAP_SYNC_TRIGGERED",
  });
  const bootstrapRequested = completionTransition.outputs.some(
    (output) => output.type === "BOOTSTRAP_REQUESTED",
  );
  if (!bootstrapRequested) {
    throw new OAuthSourceProvisioningInvariantError();
  }
  dependencies.triggerSync(userId, provider);

  return accountId;
};

interface ImportOAuthAccountOptions {
  userId: string;
  provider: string;
  oauthCredentialId: string;
  accessToken: string;
  email: string | null;
}

const importOAuthAccountCalendars = async (
  options: ImportOAuthAccountOptions,
): Promise<string> => {
  const { database } = await import("@/context");

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${options.userId}))`,
    );

    const dependencies = createDefaultImportOAuthAccountDependencies();

    return importOAuthAccountCalendarsWithDependencies(options, {
      ...dependencies,
      countUserAccounts: (userId) => countUserAccountsWithDatabase(tx, userId),
      createAccountId: async (accountOptions) => {
        const accountId = await createOAuthAccountIdWithDatabase(tx, accountOptions);
        if (!accountId) {
          throw new OAuthImportAccountCreateError();
        }
        return accountId;
      },
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
  UnsupportedOAuthProviderError,
  OAuthSourceAccountCreateError,
  OAuthSourceCreateError,
  OAuthSourceProvisioningInvariantError,
  OAuthImportAccountCreateError,
  getUserOAuthSources,
  verifyOAuthSourceOwnership,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
  createOAuthSource,
  createOAuthSourceWithDependencies,
  importOAuthAccountCalendars,
  importOAuthAccountCalendarsWithDependencies,
};

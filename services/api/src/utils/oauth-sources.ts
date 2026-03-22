import {
  calendarAccountsTable,
} from "@keeper.sh/database/schema";
import { sql } from "drizzle-orm";
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
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  OAuthImportAccountCreateError,
  OAuthSourceAccountCreateError,
  OAuthSourceCreateError,
  OAuthSourceLimitError,
  OAuthSourceProvisioningInvariantError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  UnsupportedOAuthProviderError,
} from "./oauth-source-errors";
import {
  assertOAuthProviderId,
  isOAuthProviderId,
  listExternalOAuthCalendars,
} from "./oauth-source-provider";
import {
  getOAuthDestinationCredentialsWithDatabase,
  getOAuthSourceCredentialsWithDatabase,
  getUserOAuthSourcesWithDatabase,
  verifyOAuthSourceOwnershipWithDatabase,
  type OAuthAccountWithCredentials,
  type OAuthCalendarSource,
  type OAuthSourceWithCredentials,
} from "./oauth-source-query-repository";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

const getUserOAuthSources = async (
  userId: string,
  provider: string,
): Promise<OAuthCalendarSource[]> => {
  const { database } = await import("@/context");
  return getUserOAuthSourcesWithDatabase(database, userId, provider);
};

const verifyOAuthSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const { database } = await import("@/context");
  return verifyOAuthSourceOwnershipWithDatabase(database, userId, calendarId);
};

const getOAuthDestinationCredentials = async (
  userId: string,
  accountId: string,
  provider: string,
): Promise<OAuthAccountWithCredentials> => {
  const { database } = await import("@/context");
  return getOAuthDestinationCredentialsWithDatabase(database, userId, accountId, provider);
};

const getOAuthSourceCredentials = async (
  userId: string,
  credentialId: string,
  provider: string,
): Promise<OAuthSourceWithCredentials> => {
  const { database } = await import("@/context");
  return getOAuthSourceCredentialsWithDatabase(database, userId, credentialId, provider);
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
  listCalendars: (provider, accessToken) => listExternalOAuthCalendars(provider, accessToken),
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

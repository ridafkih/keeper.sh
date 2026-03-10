import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/provider-google-calendar";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/provider-outlook";
import { spawnBackgroundJob } from "./background-task";
import { getSourceProvider } from "@keeper.sh/provider-registry/server";
import { applySourceSyncDefaults } from "./source-sync-defaults";
import { database, premiumService, oauthProviders } from "../context";

import { triggerDestinationSync } from "./sync";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_CALENDAR_TYPE = "oauth";

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

const countUserAccounts = async (userId: string): Promise<number> => {
  const accounts = await database
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return accounts.length;
};

const findOAuthAccountId = async (
  options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  },
): Promise<string | null> => {
  const { userId, provider, oauthCredentialId } = options;

  const [existingAccount] = await database
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

const syncOAuthSourcesByProvider = async (providerId: string): Promise<void> => {
  const sourceProvider = getSourceProvider(providerId, { database, oauthProviders });
  if (!sourceProvider) {
    return;
  }
  await sourceProvider.syncAllSources();
};

const createOAuthSource = async (
  options: CreateOAuthSourceOptions,
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

  const [credential] = await database
    .select({ email: oauthCredentialsTable.email })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, oauthCredentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!credential) {
    throw new Error("Source credential not found");
  }

  const existingAccountId = await findOAuthAccountId({
    oauthCredentialId,
    provider,
    userId,
  });

  const [existingCalendar] = await database
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

  if (existingCalendar) {
    throw new DuplicateSourceError();
  }

  let accountId = existingAccountId;

  if (!accountId) {
    const existingAccountCount = await countUserAccounts(userId);
    const allowed = await premiumService.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      throw new OAuthSourceLimitError();
    }

    const [account] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "oauth",
        displayName: credential.email,
        email: credential.email,
        oauthCredentialId,
        provider,
        userId,
      })
      .returning({ id: calendarAccountsTable.id });

    if (!account) {
      throw new Error("Failed to create calendar account");
    }

    accountId = account.id;
  }

  const [source] = await database
    .insert(calendarsTable)
    .values(applySourceSyncDefaults({
      accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      excludeFocusTime,
      excludeOutOfOffice,
      excludeWorkingLocation,
      externalCalendarId,
      name,
      originalName: name,
      userId,
    }))
    .returning();

  if (!source) {
    throw new Error("Failed to create OAuth calendar source");
  }

  spawnBackgroundJob("oauth-source-sync", { userId, provider }, async () => {
    await syncOAuthSourcesByProvider(provider);
    triggerDestinationSync(userId);
  });

  return {
    email: credential.email,
    id: source.id,
    name: source.name,
    provider,
  };
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

const createOAuthAccountId = async (
  options: Pick<ImportOAuthAccountOptions, "userId" | "provider" | "oauthCredentialId" | "email">,
): Promise<string> => {
  const { userId, provider, oauthCredentialId, email } = options;

  const [insertedAccount] = await database
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

const getUnimportedExternalCalendars = async (
  userId: string,
  accountId: string,
  externalCalendars: ExternalCalendar[],
): Promise<ExternalCalendar[]> => {
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
};

const insertOAuthCalendars = async (
  userId: string,
  accountId: string,
  calendars: ExternalCalendar[],
): Promise<void> => {
  if (calendars.length === 0) {
    return;
  }

  await database
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

const triggerOAuthImportSync = (userId: string, provider: string): void => {
  spawnBackgroundJob("oauth-account-import", { userId, provider }, async () => {
    await syncOAuthSourcesByProvider(provider);
    triggerDestinationSync(userId);
  });
};

const importOAuthAccountCalendars = async (options: ImportOAuthAccountOptions): Promise<string> => {
  const { userId, provider, oauthCredentialId, accessToken, email } = options;

  const listCalendars = listProviderCalendars[provider];
  if (!listCalendars) {
    throw new Error(`No calendar listing support for provider: ${provider}`);
  }

  const existingAccountId = await findOAuthAccountId({
    oauthCredentialId,
    provider,
    userId,
  });
  let accountId = existingAccountId;

  if (!accountId) {
    const existingAccountCount = await countUserAccounts(userId);
    const allowed = await premiumService.canAddAccount(userId, existingAccountCount);
    if (!allowed) {
      throw new OAuthSourceLimitError();
    }

    accountId = await createOAuthAccountId({
      email,
      oauthCredentialId,
      provider,
      userId,
    });
  }

  const externalCalendars = await listCalendars(accessToken);
  const newCalendars = await getUnimportedExternalCalendars(userId, accountId, externalCalendars);

  if (newCalendars.length === 0) {return accountId;}

  await insertOAuthCalendars(userId, accountId, newCalendars);
  triggerOAuthImportSync(userId, provider);

  return accountId;
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
  importOAuthAccountCalendars,
};

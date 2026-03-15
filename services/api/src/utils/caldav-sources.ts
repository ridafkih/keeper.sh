import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { encryptPassword } from "@keeper.sh/database";
import { database, premiumService, encryptionKey } from "../context";
import { triggerDestinationSync } from "./sync";
import { applySourceSyncDefaults } from "./source-sync-defaults";

const FIRST_RESULT_LIMIT = 1;
const CALDAV_CALENDAR_TYPE = "caldav";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
type CaldavSourceDatabase = Pick<
  typeof database,
  "insert" | "select" | "selectDistinct"
>;

class CalDAVSourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

class DuplicateCalDAVSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

interface CalDAVSource {
  id: string;
  accountId: string;
  userId: string;
  name: string;
  provider: string;
  calendarUrl: string;
  serverUrl: string;
  username: string;
  createdAt: Date;
}

interface CreateCalDAVSourceData {
  calendarUrl: string;
  name: string;
  password: string;
  provider: string;
  serverUrl: string;
  username: string;
}

const findReusableCalDAVAccount = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  provider: string,
  serverUrl: string,
  username: string,
): Promise<{ id: string; caldavCredentialId: string | null } | undefined> => {
  const [account] = await databaseClient
    .select({
      id: calendarAccountsTable.id,
      caldavCredentialId: calendarAccountsTable.caldavCredentialId,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        eq(caldavCredentialsTable.serverUrl, serverUrl),
        eq(caldavCredentialsTable.username, username),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return account;
};

const createCalDAVAccount = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  data: CreateCalDAVSourceData,
  resolvedEncryptionKey: string,
): Promise<string> => {
  const encryptedPassword = encryptPassword(data.password, resolvedEncryptionKey);

  const [credential] = await databaseClient
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword,
      serverUrl: data.serverUrl,
      username: data.username,
    })
    .returning({ id: caldavCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create CalDAV source credential");
  }

  const [account] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential.id,
      displayName: data.username,
      provider: data.provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  if (!account) {
    throw new Error("Failed to create calendar account");
  }

  return account.id;
};

const getUserCalDAVSources = async (userId: string, provider?: string): Promise<CalDAVSource[]> => {
  const conditions = [
    eq(calendarsTable.userId, userId),
    eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
    inArray(calendarsTable.id,
      database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
        .from(sourceDestinationMappingsTable)
    ),
  ];

  if (provider) {
    conditions.push(eq(calendarAccountsTable.provider, provider));
  }

  const sources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarUrl: calendarsTable.calendarUrl,
      createdAt: calendarsTable.createdAt,
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarsTable.userId,
      username: caldavCredentialsTable.username,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(...conditions));

  return sources.map((source) => {
    if (!source.calendarUrl) {
      throw new Error(`CalDAV source ${source.id} is missing calendarUrl`);
    }
    return {
      ...source,
      calendarUrl: source.calendarUrl,
      provider: source.provider,
    };
  });
};

const countUserAccountsWithDatabase = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
): Promise<number> => {
  const [result] = await databaseClient
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const createCalDAVSource = async (
  userId: string,
  data: CreateCalDAVSourceData,
): Promise<CalDAVSource> => {
  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

  const resolvedEncryptionKey = encryptionKey;

  const result = await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const [existingSource] = await tx
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarsTable.calendarUrl, data.calendarUrl),
          eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
        ),
      )
      .limit(FIRST_RESULT_LIMIT);

    if (existingSource) {
      throw new DuplicateCalDAVSourceError();
    }

    const existingAccount = await findReusableCalDAVAccount(
      tx,
      userId,
      data.provider,
      data.serverUrl,
      data.username,
    );

    if (!existingAccount) {
      const existingAccountCount = await countUserAccountsWithDatabase(tx, userId);
      const allowed = await premiumService.canAddAccount(userId, existingAccountCount);

      if (!allowed) {
        throw new CalDAVSourceLimitError();
      }
    }

    const accountId = existingAccount?.id ??
      await createCalDAVAccount(tx, userId, data, resolvedEncryptionKey);

    const [source] = await tx
      .insert(calendarsTable)
      .values(applySourceSyncDefaults({
        accountId,
        calendarType: CALDAV_CALENDAR_TYPE,
        capabilities: ["pull", "push"],
        calendarUrl: data.calendarUrl,
        name: data.name,
        originalName: data.name,
        userId,
      }))
      .returning();

    if (!source) {
      throw new Error("Failed to create CalDAV source");
    }

    return {
      accountId,
      calendarUrl: data.calendarUrl,
      createdAt: source.createdAt,
      id: source.id,
      name: source.name,
      provider: data.provider,
      serverUrl: data.serverUrl,
      userId: source.userId,
      username: data.username,
    };
  });

  triggerDestinationSync(userId);

  return result;
};

const verifyCalDAVSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const [source] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

export {
  CalDAVSourceLimitError,
  DuplicateCalDAVSourceError,
  getUserCalDAVSources,
  createCalDAVSource,
  verifyCalDAVSourceOwnership,
};

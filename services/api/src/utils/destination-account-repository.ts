import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { DestinationAccountOwnershipError } from "./destination-errors";
import type { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

type DestinationDatabase = Pick<typeof database, "insert" | "select" | "selectDistinct" | "update">;

interface ExistingAccount {
  id: string;
  userId: string;
  oauthCredentialId: string | null;
  caldavCredentialId: string | null;
}

interface AccountInsertData {
  userId: string;
  provider: string;
  accountId: string;
  email: string | null;
  oauthCredentialId?: string;
  caldavCredentialId?: string;
  needsReauthentication?: boolean;
}

const findMappedDestinationCalendarForAccountIdWithDatabase = async (
  databaseClient: DestinationDatabase,
  accountId: string,
): Promise<{ id: string } | undefined> => {
  const [existingCalendar] = await databaseClient
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.accountId, accountId),
        inArray(
          calendarsTable.id,
          databaseClient
            .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return existingCalendar;
};

const findExistingDestinationAccountWithDatabase = async (
  databaseClient: DestinationDatabase,
  provider: string,
  accountId: string,
): Promise<ExistingAccount | undefined> => {
  const [account] = await databaseClient
    .select({
      caldavCredentialId: calendarAccountsTable.caldavCredentialId,
      id: calendarAccountsTable.id,
      oauthCredentialId: calendarAccountsTable.oauthCredentialId,
      userId: calendarAccountsTable.userId,
    })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.accountId, accountId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return account;
};

const validateDestinationAccountOwnership = (
  existingAccount: ExistingAccount | undefined,
  userId: string,
): void => {
  if (existingAccount && existingAccount.userId !== userId) {
    throw new DestinationAccountOwnershipError();
  }
};

const initializeDestinationSyncStatusWithDatabase = async (
  databaseClient: DestinationDatabase,
  calendarId: string,
): Promise<void> => {
  await databaseClient.insert(syncStatusTable).values({ calendarId }).onConflictDoNothing();
};

const setupNewDestinationWithDatabase = async (
  databaseClient: DestinationDatabase,
  calendarId: string,
): Promise<void> => {
  await initializeDestinationSyncStatusWithDatabase(databaseClient, calendarId);
};

const upsertAccountAndCalendarWithDatabase = async (
  databaseClient: DestinationDatabase,
  data: AccountInsertData,
): Promise<string | undefined> => {
  const { oauthCredentialId, caldavCredentialId, needsReauthentication, ...base } = data;
  const setClause: Record<string, unknown> = { email: base.email };

  if (oauthCredentialId) {
    setClause.oauthCredentialId = oauthCredentialId;
    setClause.needsReauthentication = needsReauthentication ?? false;
  }
  if (caldavCredentialId) {
    setClause.caldavCredentialId = caldavCredentialId;
  }

  const authType = oauthCredentialId ? "oauth" : "caldav";
  const [account] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      accountId: base.accountId,
      authType,
      caldavCredentialId,
      email: base.email,
      needsReauthentication,
      oauthCredentialId,
      provider: base.provider,
      userId: base.userId,
    })
    .onConflictDoUpdate({
      set: setClause,
      target: [calendarAccountsTable.provider, calendarAccountsTable.accountId],
    })
    .returning({ id: calendarAccountsTable.id });

  if (!account) {
    return;
  }

  const existingCalendar = await findMappedDestinationCalendarForAccountIdWithDatabase(
    databaseClient,
    account.id,
  );
  if (existingCalendar) {
    return existingCalendar.id;
  }

  const [calendar] = await databaseClient
    .insert(calendarsTable)
    .values({
      accountId: account.id,
      calendarType: authType,
      capabilities: ["pull", "push"],
      name: `${base.provider} destination`,
      userId: base.userId,
    })
    .returning({ id: calendarsTable.id });

  return calendar?.id;
};

export {
  findMappedDestinationCalendarForAccountIdWithDatabase,
  findExistingDestinationAccountWithDatabase,
  validateDestinationAccountOwnership,
  initializeDestinationSyncStatusWithDatabase,
  setupNewDestinationWithDatabase,
  upsertAccountAndCalendarWithDatabase,
};
export type {
  DestinationDatabase,
  ExistingAccount,
};

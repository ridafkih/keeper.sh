import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { eq, inArray } from "drizzle-orm";
import type { database } from "@/context";
import { RECONNECTED_BACKOFF_STATE } from "./calendar-state";

type SourceReauthenticationDatabase = Pick<typeof database, "update">;

const clearSourceReauthentication = async (
  databaseClient: SourceReauthenticationDatabase,
  oauthCredentialId: string,
): Promise<void> => {
  const accounts = await databaseClient
    .update(calendarAccountsTable)
    .set({ needsReauthentication: false })
    .where(eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId))
    .returning({ id: calendarAccountsTable.id });

  if (accounts.length === 0) {
    return;
  }

  await databaseClient
    .update(calendarsTable)
    .set(RECONNECTED_BACKOFF_STATE)
    .where(inArray(calendarsTable.accountId, accounts.map(({ id }) => id)));
};

const clearAccountReauthentication = async (
  databaseClient: SourceReauthenticationDatabase,
  accountId: string,
): Promise<void> => {
  await databaseClient
    .update(calendarAccountsTable)
    .set({ needsReauthentication: false })
    .where(eq(calendarAccountsTable.id, accountId));

  await databaseClient
    .update(calendarsTable)
    .set(RECONNECTED_BACKOFF_STATE)
    .where(eq(calendarsTable.accountId, accountId));
};

export { clearAccountReauthentication, clearSourceReauthentication };
export type { SourceReauthenticationDatabase };

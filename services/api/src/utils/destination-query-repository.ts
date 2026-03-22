import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;
const EMPTY_RESULT_COUNT = 0;

type DestinationDatabase = Pick<typeof database, "delete" | "select" | "selectDistinct">;

interface CalendarDestinationRecord {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

const listCalendarDestinationsWithDatabase = async (
  databaseClient: DestinationDatabase,
  userId: string,
): Promise<CalendarDestinationRecord[]> => {
  const accounts = await databaseClient
    .select({
      email: calendarAccountsTable.email,
      id: calendarAccountsTable.id,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      provider: calendarAccountsTable.provider,
    })
    .from(calendarAccountsTable)
    .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        inArray(
          calendarsTable.id,
          databaseClient
            .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  return accounts;
};

const deleteCalendarDestinationWithDatabase = async (
  databaseClient: DestinationDatabase,
  userId: string,
  accountId: string,
): Promise<boolean> => {
  const result = await databaseClient
    .delete(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.id, accountId),
      ),
    )
    .returning({ id: calendarAccountsTable.id });

  return result.length > EMPTY_RESULT_COUNT;
};

const getDestinationAccountExternalIdWithDatabase = async (
  databaseClient: DestinationDatabase,
  userId: string,
  accountId: string,
): Promise<string | null> => {
  const [account] = await databaseClient
    .select({ accountId: calendarAccountsTable.accountId })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (account?.accountId) {
    return account.accountId;
  }
  return null;
};

export {
  deleteCalendarDestinationWithDatabase,
  getDestinationAccountExternalIdWithDatabase,
  listCalendarDestinationsWithDatabase,
};
export type {
  CalendarDestinationRecord,
};

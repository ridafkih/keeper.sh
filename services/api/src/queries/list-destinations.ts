import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { KeeperDatabase, KeeperDestination } from "@/types";

const listDestinations = async (database: KeeperDatabase, userId: string): Promise<KeeperDestination[]> => {
  const accounts = await database
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
          database
            .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  return accounts;
};

export { listDestinations };

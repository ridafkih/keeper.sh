import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { asc, eq } from "drizzle-orm";
import { withAccountDisplay } from "../provider-display";
import type { KeeperDatabase, KeeperSource } from "../types";

const listSources = async (database: KeeperDatabase, userId: string): Promise<KeeperSource[]> => {
  const calendars = await database
    .select({
      id: calendarsTable.id,
      name: calendarsTable.name,
      calendarType: calendarsTable.calendarType,
      capabilities: calendarsTable.capabilities,
      accountId: calendarAccountsTable.id,
      provider: calendarAccountsTable.provider,
      displayName: calendarAccountsTable.displayName,
      email: calendarAccountsTable.email,
      accountIdentifier: calendarAccountsTable.accountId,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      includeInIcalFeed: calendarsTable.includeInIcalFeed,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(eq(calendarsTable.userId, userId))
    .orderBy(asc(calendarsTable.createdAt));

  return calendars.map((calendar) => withAccountDisplay(calendar));
};

export { listSources };

import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { asc, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
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
        needsReauthentication: calendarAccountsTable.needsReauthentication,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(eq(calendarsTable.userId, userId))
      .orderBy(asc(calendarsTable.createdAt));

    return Response.json(calendars);
  }),
);

export { GET };

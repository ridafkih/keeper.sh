import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { asc, eq, sql, count } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const accounts = await database
      .select({
        id: calendarAccountsTable.id,
        provider: calendarAccountsTable.provider,
        displayName: calendarAccountsTable.displayName,
        email: calendarAccountsTable.email,
        authType: calendarAccountsTable.authType,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        calendarCount: count(calendarsTable.id),
        createdAt: calendarAccountsTable.createdAt,
      })
      .from(calendarAccountsTable)
      .leftJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(eq(calendarAccountsTable.userId, userId))
      .groupBy(calendarAccountsTable.id)
      .orderBy(asc(calendarAccountsTable.createdAt));

    return Response.json(accounts);
  }),
);

export { GET };

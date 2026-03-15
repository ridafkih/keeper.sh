import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { withAccountDisplay } from "@/utils/provider-display";

const GET = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const providerFilter = url.searchParams.get("provider");

    const conditions = [eq(calendarAccountsTable.userId, userId)];

    if (providerFilter) {
      const providers = providerFilter.split(",").filter(Boolean);
      conditions.push(inArray(calendarAccountsTable.provider, providers));
    }

    const accounts = await database
      .select({
        id: calendarAccountsTable.id,
        provider: calendarAccountsTable.provider,
        displayName: calendarAccountsTable.displayName,
        email: calendarAccountsTable.email,
        accountIdentifier: calendarAccountsTable.accountId,
        authType: calendarAccountsTable.authType,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        calendarCount: count(calendarsTable.id),
        createdAt: calendarAccountsTable.createdAt,
      })
      .from(calendarAccountsTable)
      .leftJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(and(...conditions))
      .groupBy(calendarAccountsTable.id)
      .orderBy(asc(calendarAccountsTable.createdAt));

    return Response.json(accounts.map((account) => withAccountDisplay(account)));
  }),
);

export { GET };

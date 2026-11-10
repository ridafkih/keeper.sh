import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { isCalendarId } from "@/utils/calendar-pause";
import { runDeleteCalendarAccount } from "@/utils/delete-calendar-account";
import { createDeleteCalendarAccountDependencies } from "@/utils/delete-calendar-account-dependencies";
import { handleDeleteIcsSourceRoute } from "@/routes/api/ics/source-routes";
import { database } from "@/context";

const ICS_PROVIDER = "ics";

const findLinkAccountId = async (userId: string, calendarId: string): Promise<string | null> => {
  const [link] = await database
    .select({ accountId: calendarsTable.accountId })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(and(
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.userId, userId),
      eq(calendarAccountsTable.provider, ICS_PROVIDER),
    ))
    .limit(1);
  return link?.accountId ?? null;
};

const DELETE = withWideEvent(
  withV1Auth(({ params, userId }) => {
    if (!isCalendarId(params.id)) {
      return ErrorResponse.badRequest("A valid calendar ID is required.").toResponse();
    }

    return handleDeleteIcsSourceRoute({ params, userId }, {
      deleteAccount: (accountUserId, accountId) =>
        runDeleteCalendarAccount(
          { accountId, userId: accountUserId },
          createDeleteCalendarAccountDependencies(),
        ),
      findLinkAccountId,
    });
  }),
);

export { DELETE };

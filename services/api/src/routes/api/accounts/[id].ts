import { caldavCredentialsTable, calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";
import { database } from "@/context";
import { withAccountDisplay } from "@/utils/provider-display";
import { runDeleteCalendarAccount } from "@/utils/delete-calendar-account";
import { createDeleteCalendarAccountDependencies } from "@/utils/delete-calendar-account-dependencies";
import { MappingMutationBusyError } from "@/utils/source-destination-mappings";

const deleteAccountOrReportBusy = async (
  accountId: string,
  userId: string,
): Promise<boolean | Response> => {
  try {
    return await runDeleteCalendarAccount(
      { accountId, userId },
      createDeleteCalendarAccountDependencies(),
    );
  } catch (error) {
    if (error instanceof MappingMutationBusyError) {
      return ErrorResponse.conflict(error.message).toResponse();
    }
    throw error;
  }
};

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Account ID is required").toResponse();
    }
    const { id } = params;

    const [account] = await database
      .select({
        id: calendarAccountsTable.id,
        provider: calendarAccountsTable.provider,
        displayName: calendarAccountsTable.displayName,
        email: calendarAccountsTable.email,
        accountIdentifier: calendarAccountsTable.accountId,
        authType: calendarAccountsTable.authType,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        calendarCount: count(calendarsTable.id),
        calendarsRefreshedAt: calendarAccountsTable.calendarsRefreshedAt,
        createdAt: calendarAccountsTable.createdAt,
        /* Reconnecting a CalDAV account replaces only the password, so the page needs
           the rest of the credential to show what it is repairing. */
        caldavServerUrl: caldavCredentialsTable.serverUrl,
        caldavUsername: caldavCredentialsTable.username,
      })
      .from(calendarAccountsTable)
      .leftJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .leftJoin(
        caldavCredentialsTable,
        eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarAccountsTable.id, id),
          eq(calendarAccountsTable.userId, userId),
        ),
      )
      .groupBy(calendarAccountsTable.id, caldavCredentialsTable.id)
      .limit(1);

    if (!account) {
      return ErrorResponse.notFound("Account not found").toResponse();
    }

    return Response.json(withAccountDisplay(account));
  }),
);

const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Account ID is required").toResponse();
    }
    const { id } = params;

    const deleted = await deleteAccountOrReportBusy(id, userId);

    if (deleted instanceof Response) {
      return deleted;
    }

    if (!deleted) {
      return ErrorResponse.notFound("Account not found").toResponse();
    }

    return Response.json({ success: true });
  }),
);

export { GET, DELETE };

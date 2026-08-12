import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";
import { database } from "@/context";
import { withAccountDisplay } from "@/utils/provider-display";
import { getCalendarsAffectedByAccountMutation } from "@/utils/invalidate-calendars";
import {
  requestUserSync,
  scheduleMappingReplacementSync,
  withMappingMutationLocks,
} from "@/utils/source-destination-mappings";

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
        createdAt: calendarAccountsTable.createdAt,
      })
      .from(calendarAccountsTable)
      .leftJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(
        and(
          eq(calendarAccountsTable.id, id),
          eq(calendarAccountsTable.userId, userId),
        ),
      )
      .groupBy(calendarAccountsTable.id)
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

    const affected = await getCalendarsAffectedByAccountMutation(database, userId, id);
    if (!affected.owned) {
      return ErrorResponse.notFound("Account not found").toResponse();
    }

    const { result: deleted } = await withMappingMutationLocks(
      userId,
      async () => {
        const currentAffected = await getCalendarsAffectedByAccountMutation(
          database,
          userId,
          id,
        );
        return currentAffected.calendarIds;
      },
      () => database.transaction(async (transaction) => {
        await requestUserSync(transaction, userId);
        const [deletedAccount] = await transaction
          .delete(calendarAccountsTable)
          .where(
            and(
              eq(calendarAccountsTable.id, id),
              eq(calendarAccountsTable.userId, userId),
            ),
          )
          .returning({ id: calendarAccountsTable.id });
        return deletedAccount;
      }),
    );

    if (!deleted) {
      return ErrorResponse.notFound("Account not found").toResponse();
    }

    scheduleMappingReplacementSync(userId);

    return Response.json({ success: true });
  }),
);

export { GET, DELETE };

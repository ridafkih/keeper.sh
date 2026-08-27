import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq, notExists } from "drizzle-orm";
import { database } from "@/context";
import { widelog } from "@/utils/logging";
import { getCalendarsAffectedByAccountMutation } from "@/utils/invalidate-calendars";
import { deregisterAccountPushChannels } from "@/utils/push-notifications/deregister-account-channels";
import {
  requestUserSync,
  scheduleMappingReplacementSync,
  withMappingMutationLocks,
} from "@/utils/source-destination-mappings";
import type { DeleteCalendarAccountDependencies } from "@/utils/delete-calendar-account";

const createDeleteCalendarAccountDependencies = (): DeleteCalendarAccountDependencies => ({
  deleteAccountRow: async ({ accountId, userId }) => {
    const { result: deleted } = await withMappingMutationLocks(
      userId,
      async () => {
        const currentAffected = await getCalendarsAffectedByAccountMutation(
          database,
          userId,
          accountId,
        );
        return currentAffected.calendarIds;
      },
      () => database.transaction(async (transaction) => {
        await requestUserSync(transaction, userId);
        const [deletedAccount] = await transaction
          .delete(calendarAccountsTable)
          .where(
            and(
              eq(calendarAccountsTable.id, accountId),
              eq(calendarAccountsTable.userId, userId),
            ),
          )
          .returning({
            id: calendarAccountsTable.id,
            oauthCredentialId: calendarAccountsTable.oauthCredentialId,
          });

        const orphanedCredentialId = deletedAccount?.oauthCredentialId;
        if (orphanedCredentialId) {
          await transaction
            .delete(oauthCredentialsTable)
            .where(
              and(
                eq(oauthCredentialsTable.id, orphanedCredentialId),
                eq(oauthCredentialsTable.userId, userId),
                notExists(
                  transaction
                    .select({ id: calendarAccountsTable.id })
                    .from(calendarAccountsTable)
                    .where(
                      and(
                        eq(calendarAccountsTable.oauthCredentialId, orphanedCredentialId),
                        eq(calendarAccountsTable.userId, userId),
                      ),
                    ),
                ),
              ),
            );
        }

        return deletedAccount;
      }),
    );

    return Boolean(deleted);
  },
  deregisterPushChannels: deregisterAccountPushChannels,
  isOwnedByUser: async ({ accountId, userId }) => {
    const affected = await getCalendarsAffectedByAccountMutation(database, userId, accountId);
    return affected.owned;
  },
  recordError: (error, slug) => {
    widelog.errorFields(error, { retriable: false, slug });
  },
  scheduleReplacementSync: scheduleMappingReplacementSync,
});

export { createDeleteCalendarAccountDependencies };

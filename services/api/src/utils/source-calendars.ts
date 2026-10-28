import { calendarRemovalsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database, redis } from "@/context";
import { widelog } from "@/utils/logging";
import { runDeleteSourceCalendar } from "@/utils/delete-source-calendar";
import type { DeleteSourceCalendarOutcome } from "@/utils/delete-source-calendar";
import { deregisterCalendarPushChannels } from "@/utils/push-notifications/deregister-account-channels";

const INVALIDATION_PREFIX = "sync:invalidated:";
const INVALIDATION_TTL_SECONDS = 300;

const deleteSourceCalendar = async (
  userId: string,
  calendarId: string,
): Promise<DeleteSourceCalendarOutcome> =>
  await runDeleteSourceCalendar({ calendarId, userId }, {
    deleteCalendarRow: async (context) => {
      const removed = await database.transaction(async (tx) => {
        const [row] = await tx
          .delete(calendarsTable)
          .where(
            and(
              eq(calendarsTable.id, context.calendarId),
              eq(calendarsTable.userId, context.userId),
            ),
          )
          .returning({
            accountId: calendarsTable.accountId,
            calendarType: calendarsTable.calendarType,
            calendarUrl: calendarsTable.calendarUrl,
            externalCalendarId: calendarsTable.externalCalendarId,
          });

        if (!row) {
          return false;
        }

        await tx
          .insert(calendarRemovalsTable)
          .values({
            accountId: row.accountId,
            calendarType: row.calendarType,
            calendarUrl: row.calendarUrl,
            externalCalendarId: row.externalCalendarId,
            userId: context.userId,
          })
          .onConflictDoNothing();

        return true;
      });

      if (!removed) {
        return false;
      }

      await redis.set(
        `${INVALIDATION_PREFIX}${context.calendarId}`,
        "1",
        "EX",
        INVALIDATION_TTL_SECONDS,
      );
      return true;
    },
    deregisterPushChannels: deregisterCalendarPushChannels,
    loadCandidate: async (context) => {
      const [row] = await database
        .select({
          capabilities: calendarsTable.capabilities,
          providerMissingSince: calendarsTable.providerMissingSince,
          unavailableSince: calendarsTable.unavailableSince,
        })
        .from(calendarsTable)
        .where(
          and(
            eq(calendarsTable.id, context.calendarId),
            eq(calendarsTable.userId, context.userId),
          ),
        )
        .limit(1);
      if (!row) {
        return null;
      }
      return {
        capabilities: row.capabilities,
        missingAtProvider: row.providerMissingSince !== null || row.unavailableSince !== null,
      };
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: false, slug });
    },
  });

export { deleteSourceCalendar };

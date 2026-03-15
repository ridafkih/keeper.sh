import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { fetchAndSyncSource, pullRemoteCalendar } from "@keeper.sh/calendar/ics";
import { and, count, eq, sql } from "drizzle-orm";
import { triggerDestinationSync } from "./sync";
import {
  SourceLimitError,
  InvalidSourceUrlError,
  runCreateSource,
} from "./source-lifecycle";
import { applySourceSyncDefaults } from "./source-sync-defaults";

import { spawnBackgroundJob } from "./background-task";
import { database, premiumService } from "@/context";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

const FIRST_RESULT_LIMIT = 1;
const ICAL_CALENDAR_TYPE = "ical";
type Source = typeof calendarsTable.$inferSelect;

const getUserSources = async (userId: string): Promise<Source[]> => {
  const sources = await database
    .select()
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, ICAL_CALENDAR_TYPE),
      ),
    );

  return sources;
};

const verifySourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const [source] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, ICAL_CALENDAR_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

const validateSourceUrl = async (url: string): Promise<void> => {
  await pullRemoteCalendar("json", url);
};

const createSource = (userId: string, name: string, url: string): Promise<Source> =>
  database.transaction((tx) =>
    runCreateSource(
      { userId, name, url },
      {
        acquireAccountLock: async (userIdToLock) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userIdToLock}))`,
          );
        },
        canAddAccount: (userIdToCheck, existingAccountCount) =>
          premiumService.canAddAccount(userIdToCheck, existingAccountCount),
        countExistingAccounts: async (userIdToCount) => {
          const [result] = await tx
            .select({ value: count() })
            .from(calendarAccountsTable)
            .where(eq(calendarAccountsTable.userId, userIdToCount));
          return result?.value ?? 0;
        },
        createCalendarAccount: async ({ userId: accountUserId, displayName }) => {
          const [account] = await tx
            .insert(calendarAccountsTable)
            .values({
              authType: "none",
              displayName,
              provider: "ics",
              userId: accountUserId,
            })
            .returning({ id: calendarAccountsTable.id });
          return account?.id;
        },
        createSourceCalendar: async ({ accountId, name: sourceName, url: sourceUrl, userId: sourceUserId }) => {
          const [source] = await tx
            .insert(calendarsTable)
            .values(applySourceSyncDefaults({
              accountId,
              calendarType: ICAL_CALENDAR_TYPE,
              name: sourceName,
              url: sourceUrl,
              userId: sourceUserId,
            }))
            .returning();
          return source;
        },
        fetchAndSyncSource: async (source) => {
          await fetchAndSyncSource(database, source);
        },
        spawnBackgroundJob,
        triggerDestinationSync,
        validateSourceUrl,
      },
    ),
  );

export {
  SourceLimitError,
  InvalidSourceUrlError,
  getUserSources,
  verifySourceOwnership,
  createSource,
};
export type { Source };

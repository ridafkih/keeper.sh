import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { pullRemoteCalendar, createIcsSourceFetcher } from "@keeper.sh/calendar/ics";
import { ingestSource, insertEventStatesWithConflictResolution } from "@keeper.sh/calendar";
import type { IngestionChanges } from "@keeper.sh/calendar";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { enqueuePushSync } from "./enqueue-push-sync";
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

const serializeOptionalJson = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const createIngestionFlush = (calendarId: string) =>
  async (changes: IngestionChanges): Promise<void> => {
    await database.transaction(async (transaction) => {
      if (changes.deletes.length > 0) {
        await transaction
          .delete(eventStatesTable)
          .where(
            and(
              eq(eventStatesTable.calendarId, calendarId),
              inArray(eventStatesTable.id, changes.deletes),
            ),
          );
      }

      if (changes.inserts.length > 0) {
        await insertEventStatesWithConflictResolution(
          transaction,
          changes.inserts.map((event) => ({
            availability: event.availability,
            calendarId,
            description: event.description,
            endTime: event.endTime,
            exceptionDates: serializeOptionalJson(event.exceptionDates),
            isAllDay: event.isAllDay,
            location: event.location,
            recurrenceRule: serializeOptionalJson(event.recurrenceRule),
            sourceEventType: event.sourceEventType,
            sourceEventUid: event.uid,
            startTime: event.startTime,
            startTimeZone: event.startTimeZone,
            title: event.title,
          })),
        );
      }
    });
  };

const ingestIcsSource = async (source: Source): Promise<void> => {
  if (!source.url) {
    return;
  }

  const fetcher = createIcsSourceFetcher({
    calendarId: source.id,
    url: source.url,
    database,
  });

  await ingestSource({
    calendarId: source.id,
    fetchEvents: () => fetcher.fetchEvents(),
    readExistingEvents: () =>
      database
        .select({
          availability: eventStatesTable.availability,
          endTime: eventStatesTable.endTime,
          id: eventStatesTable.id,
          isAllDay: eventStatesTable.isAllDay,
          sourceEventType: eventStatesTable.sourceEventType,
          sourceEventUid: eventStatesTable.sourceEventUid,
          startTime: eventStatesTable.startTime,
        })
        .from(eventStatesTable)
        .where(eq(eventStatesTable.calendarId, source.id)),
    flush: createIngestionFlush(source.id),
  });
};

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
          await ingestIcsSource(source);
        },
        spawnBackgroundJob,
        enqueuePushSync: async (enqueuedUserId) => {
          const plan = await premiumService.getUserPlan(enqueuedUserId);
          if (!plan) {
            throw new Error("Unable to resolve user plan for sync enqueue");
          }
          await enqueuePushSync(enqueuedUserId, plan);
        },
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

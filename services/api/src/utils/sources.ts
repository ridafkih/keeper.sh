import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import {
  pullRemoteCalendar,
  createIcsSourceFetcher,
  interpretFullDayTimedEventsAsAllDay,
  persistCalendarSnapshot,
} from "@keeper.sh/calendar/ics";
import {
  buildEventStateInsertRow,
  ingestSource,
  insertEventStatesWithConflictResolution,
} from "@keeper.sh/calendar";
import type { IngestionPersistenceWork } from "@keeper.sh/calendar";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { enqueuePushSync } from "./enqueue-push-sync";
import {
  SourceLimitError,
  InvalidSourceUrlError,
  runSourceCreationPreflight,
  runCreateSource,
} from "./source-lifecycle";
import { applySourceSyncDefaults } from "./source-sync-defaults";
import { safeFetchOptions } from "./safe-fetch-options";

import { spawnBackgroundJob } from "./background-task";
import { database, premiumService } from "@/context";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
const SOURCE_INGEST_LOCK_NAMESPACE = 9003;

const FIRST_RESULT_LIMIT = 1;
const ICAL_CALENDAR_TYPE = "ical";
type Source = typeof calendarsTable.$inferSelect;

const createIngestionPersistenceTransaction = (calendarId: string) =>
  (work: IngestionPersistenceWork) => database.transaction(async (transaction) => {
    await transaction.execute(sql`set local idle_in_transaction_session_timeout = 0`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
    );

    return work({
      readExistingEvents: () => transaction
        .select({
          availability: eventStatesTable.availability,
          description: eventStatesTable.description,
          endTime: eventStatesTable.endTime,
          exceptionDates: eventStatesTable.exceptionDates,
          id: eventStatesTable.id,
          isAllDay: eventStatesTable.isAllDay,
          location: eventStatesTable.location,
          recurrenceId: eventStatesTable.recurrenceId,
          recurrenceRule: eventStatesTable.recurrenceRule,
          sourceEventId: eventStatesTable.sourceEventId,
          sourceEventType: eventStatesTable.sourceEventType,
          sourceEventUid: eventStatesTable.sourceEventUid,
          startTime: eventStatesTable.startTime,
          startTimeZone: eventStatesTable.startTimeZone,
          title: eventStatesTable.title,
        })
        .from(eventStatesTable)
        .where(eq(eventStatesTable.calendarId, calendarId)),
      flush: async (changes) => {
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
            changes.inserts.map((event) => buildEventStateInsertRow(calendarId, event)),
          );
        }

        if (changes.snapshot) {
          await persistCalendarSnapshot(transaction, calendarId, changes.snapshot);
        }
      },
    });
  });

const ingestIcsSource = async (source: Source): Promise<void> => {
  if (!source.url) {
    return;
  }

  const fetcher = createIcsSourceFetcher({
    calendarId: source.id,
    url: source.url,
    database,
    safeFetchOptions,
  });

  await ingestSource({
    calendarId: source.id,
    fetchEvents: () =>
      fetcher.fetchEvents({
        interpretEvents: (events, context) =>
          interpretFullDayTimedEventsAsAllDay(events, {
            calendarTimeZone: context.calendarTimeZone,
            enabled: source.treatFullDayTimedEventsAsAllDay,
          }),
      }),
    withPersistenceTransaction: createIngestionPersistenceTransaction(source.id),
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
  await pullRemoteCalendar("json", url, safeFetchOptions);
};

const countExistingAccounts = async (userId: string): Promise<number> => {
  const [result] = await database
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));
  return result?.value ?? 0;
};

const createSource = async (userId: string, name: string, url: string): Promise<Source> => {
  const input = { userId, name, url };

  await runSourceCreationPreflight(input, {
    canAddAccount: (userIdToCheck, existingAccountCount) =>
      premiumService.canAddAccount(userIdToCheck, existingAccountCount),
    countExistingAccounts,
    validateSourceUrl,
  });

  return database.transaction((tx) =>
    runCreateSource(
      input,
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
      },
    ),
  );
};

export {
  SourceLimitError,
  InvalidSourceUrlError,
  getUserSources,
  verifySourceOwnership,
  createSource,
};
export type { Source };

import type { CronOptions } from "cronbake";
import { database } from "@keeper.sh/database";
import {
  remoteICalSourcesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { log } from "@keeper.sh/log";
import { and, eq, lte } from "drizzle-orm";

type FetchResult = {
  ical: string;
  sourceId: string;
};

const fetchRemoteCalendar = async (
  sourceId: string,
  url: string,
): Promise<FetchResult> => {
  log.debug("fetching remote calendar '%s'", sourceId);

  try {
    const { ical } = await pullRemoteCalendar("ical", url);
    log.debug("fetched remote calendar '%s'", sourceId);
    return { ical, sourceId };
  } catch (error) {
    log.error(error, "could not fetch remote calendar '%s'", sourceId);
    throw error;
  }
};

const insertSnapshot = async (
  payload: typeof calendarSnapshotsTable.$inferInsert,
) => {
  try {
    const [record] = await database
      .insert(calendarSnapshotsTable)
      .values(payload)
      .returning({
        createdAt: calendarSnapshotsTable.createdAt,
      });

    if (!record) {
      throw Error("Something went wrong inserting and returning the snapshot");
    }

    return record;
  } catch (error) {
    log.error(error, "failed to submit entry into the database");
  }

  return undefined;
};

/**
 * @param referenceDate Records with timestamps 24 hours older than this will be deleted
 * @returns
 */
const deleteStaleCalendarSnapshots = async (
  sourceId: string,
  referenceDate: Date,
) => {
  try {
    const timestamp = referenceDate.getTime();
    const dayBeforeTimestamp = timestamp - 24 * 60 * 60 * 1000;

    const deletedRecords = await database
      .delete(calendarSnapshotsTable)
      .where(
        and(
          eq(calendarSnapshotsTable.sourceId, sourceId),
          lte(calendarSnapshotsTable.createdAt, new Date(dayBeforeTimestamp)),
        ),
      )
      .returning({ id: calendarSnapshotsTable.id });

    const deletedRecordsCount = deletedRecords.length;

    log.debug(
      "deleted %s snapshots with sourceId '%s'",
      deletedRecordsCount,
      sourceId,
    );
  } catch (error) {
    log.error(error, "failed to delete snapshots with sourceId '%s'", sourceId);
  }
};

export default {
  name: import.meta.file,
  cron: "@every_1_minutes",
  immediate: true,
  async callback() {
    const remoteSources = await database.select().from(remoteICalSourcesTable);
    log.debug("fetched %s remote sources", remoteSources.length);

    const fetches = remoteSources.map(({ id, url }) =>
      fetchRemoteCalendar(id, url),
    );

    log.debug("got %s remote sources", fetches.length);

    const settlements = await Promise.allSettled(fetches);

    for (const settlement of settlements) {
      if (settlement.status === "rejected") continue;
      const { ical, sourceId } = settlement.value;
      insertSnapshot({ sourceId, ical }).then((record) => {
        if (!record) return;
        deleteStaleCalendarSnapshots(sourceId, record?.createdAt);
      });
    }
  },
} satisfies CronOptions;

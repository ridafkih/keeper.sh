import type { CronOptions } from "cronbake";
import { calendarSnapshotsTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { MS_PER_DAY } from "@keeper.sh/constants";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { and, eq, lte } from "drizzle-orm";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { countSettledResults } from "../utils/count-settled-results";

interface FetchResult {
  ical: string;
  sourceId: string;
}

const fetchRemoteCalendar = async (sourceId: string, url: string): Promise<FetchResult> => {
  const { ical } = await pullRemoteCalendar("ical", url);
  return { ical, sourceId };
};

const insertSnapshot = async (
  payload: typeof calendarSnapshotsTable.$inferInsert,
): Promise<{ createdAt: Date } | undefined> => {
  const [record] = await database.insert(calendarSnapshotsTable).values(payload).returning({
    createdAt: calendarSnapshotsTable.createdAt,
  });

  return record;
};

const deleteStaleCalendarSnapshots = async (
  sourceId: string,
  referenceDate: Date,
): Promise<void> => {
  const dayBeforeTimestamp = referenceDate.getTime() - MS_PER_DAY;

  await database
    .delete(calendarSnapshotsTable)
    .where(
      and(
        eq(calendarSnapshotsTable.sourceId, sourceId),
        lte(calendarSnapshotsTable.createdAt, new Date(dayBeforeTimestamp)),
      ),
    );
};

const processSnapshot = async (sourceId: string, ical: string): Promise<void> => {
  const event = new WideEvent("cron");
  event.set({
    operationName: "snapshot-insertion",
    operationType: "snapshot",
    sourceId,
  });

  await runWithWideEvent(event, async () => {
    try {
      const record = await insertSnapshot({ ical, sourceId });
      if (record) {
        await deleteStaleCalendarSnapshots(sourceId, record.createdAt);
      }
    } catch (error) {
      event.setError(error);
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

export default withCronWideEvent({
  async callback() {
    const remoteSources = await database.select().from(remoteICalSourcesTable);
    setCronEventFields({ sourceCount: remoteSources.length });

    const fetches = remoteSources.map(({ id, url }) => fetchRemoteCalendar(id, url));

    const settlements = await Promise.allSettled(fetches);
    const { succeeded, failed } = countSettledResults(settlements);
    setCronEventFields({ failedCount: failed, processedCount: succeeded });

    const insertions: Promise<void>[] = [];
    for (const settlement of settlements) {
      if (settlement.status === "fulfilled") {
        insertions.push(processSnapshot(settlement.value.sourceId, settlement.value.ical));
      }
    }

    await Promise.allSettled(insertions);
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

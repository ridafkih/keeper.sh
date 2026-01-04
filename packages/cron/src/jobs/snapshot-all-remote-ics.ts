import type { CronOptions } from "cronbake";
import {
  remoteICalSourcesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { and, eq, lte } from "drizzle-orm";
import { database } from "../context";
import { withCronWideEvent, setCronEventFields } from "../utils/with-wide-event";

type FetchResult = {
  ical: string;
  sourceId: string;
};

const fetchRemoteCalendar = async (
  sourceId: string,
  url: string,
): Promise<FetchResult> => {
  const { ical } = await pullRemoteCalendar("ical", url);
  return { ical, sourceId };
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

    return record;
  } catch {
    return undefined;
  }
};

const deleteStaleCalendarSnapshots = async (
  sourceId: string,
  referenceDate: Date,
) => {
  try {
    const timestamp = referenceDate.getTime();
    const dayBeforeTimestamp = timestamp - 24 * 60 * 60 * 1000;

    await database
      .delete(calendarSnapshotsTable)
      .where(
        and(
          eq(calendarSnapshotsTable.sourceId, sourceId),
          lte(calendarSnapshotsTable.createdAt, new Date(dayBeforeTimestamp)),
        ),
      );
  } catch {
  }
};

const countSettlementResults = (
  settlements: PromiseSettledResult<FetchResult>[]
): { succeeded: number; failed: number } => {
  const succeeded = settlements.filter(
    (settlement) => settlement.status === "fulfilled"
  ).length;
  const failed = settlements.filter(
    (settlement) => settlement.status === "rejected"
  ).length;
  return { succeeded, failed };
};

export default withCronWideEvent({
  name: import.meta.file,
  cron: "@every_1_minutes",
  immediate: true,
  async callback() {
    const remoteSources = await database.select().from(remoteICalSourcesTable);
    setCronEventFields({ sourceCount: remoteSources.length });

    const fetches = remoteSources.map(({ id, url }) =>
      fetchRemoteCalendar(id, url)
    );

    const settlements = await Promise.allSettled(fetches);
    const { succeeded, failed } = countSettlementResults(settlements);
    setCronEventFields({ processedCount: succeeded, failedCount: failed });

    for (const settlement of settlements) {
      if (settlement.status === "rejected") continue;
      const { ical, sourceId } = settlement.value;
      insertSnapshot({ sourceId, ical }).then((record) => {
        if (!record) return;
        deleteStaleCalendarSnapshots(sourceId, record.createdAt);
      });
    }
  },
}) satisfies CronOptions;

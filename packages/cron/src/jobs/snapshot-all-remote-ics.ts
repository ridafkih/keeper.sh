import type { CronOptions } from "cronbake";
import { calendarSnapshotsTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { MS_PER_HOUR } from "@keeper.sh/constants";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { and, desc, eq, lte } from "drizzle-orm";
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

const SNAPSHOT_RETENTION_HOURS = 6;
const SNAPSHOT_RETENTION_MS = SNAPSHOT_RETENTION_HOURS * MS_PER_HOUR;

const deleteStaleCalendarSnapshots = async (
  sourceId: string,
  referenceDate: Date,
): Promise<void> => {
  const staleThreshold = referenceDate.getTime() - SNAPSHOT_RETENTION_MS;

  await database
    .delete(calendarSnapshotsTable)
    .where(
      and(
        eq(calendarSnapshotsTable.sourceId, sourceId),
        lte(calendarSnapshotsTable.createdAt, new Date(staleThreshold)),
      ),
    );
};

const getLatestSnapshotHash = async (sourceId: string): Promise<string | null> => {
  const [latest] = await database
    .select({ contentHash: calendarSnapshotsTable.contentHash })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.sourceId, sourceId))
    .orderBy(desc(calendarSnapshotsTable.createdAt))
    .limit(1);

  return latest?.contentHash ?? null;
};

const computeContentHash = (content: string): string => Bun.hash(content).toString();

const processSnapshot = async (sourceId: string, ical: string): Promise<void> => {
  const event = new WideEvent("cron");
  event.set({
    operationName: "snapshot-insertion",
    operationType: "snapshot",
    sourceId,
  });

  await runWithWideEvent(event, async () => {
    try {
      const contentHash = computeContentHash(ical);
      const latestHash = await getLatestSnapshotHash(sourceId);

      if (latestHash === contentHash) {
        event.set({ skipped: true, skipReason: "content-unchanged" });
        return;
      }

      const record = await insertSnapshot({ contentHash, ical, sourceId });
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
    for (const [index, settlement] of settlements.entries()) {
      if (settlement.status === "fulfilled") {
        insertions.push(processSnapshot(settlement.value.sourceId, settlement.value.ical));
      } else {
        const source = remoteSources[index];
        if (source) {
          const event = new WideEvent("cron");
          event.set({
            operationName: "snapshot-fetch",
            operationType: "snapshot",
            sourceId: source.id,
          });
          event.setError(settlement.reason);
          emitWideEvent(event.finalize());
        }
      }
    }

    await Promise.allSettled(insertions);
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

import type { CronOptions } from "cronbake";
import { calendarSnapshotsTable, calendarSourcesTable } from "@keeper.sh/database/schema";
import { MS_PER_HOUR } from "@keeper.sh/constants";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { WideEvent } from "@keeper.sh/log";
import { and, desc, eq, lte } from "drizzle-orm";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { countSettledResults } from "../utils/count-settled-results";

const ICAL_SOURCE_TYPE = "ical";

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

interface SnapshotResult {
  skipped: boolean;
  error: boolean;
}

const processSnapshot = async (sourceId: string, ical: string): Promise<SnapshotResult> => {
  try {
    const contentHash = computeContentHash(ical);
    const latestHash = await getLatestSnapshotHash(sourceId);

    if (latestHash === contentHash) {
      return { error: false, skipped: true };
    }

    const record = await insertSnapshot({ contentHash, ical, sourceId });
    if (record) {
      await deleteStaleCalendarSnapshots(sourceId, record.createdAt);
    }
    return { error: false, skipped: false };
  } catch (error) {
    WideEvent.error(error);
    return { error: true, skipped: false };
  }
};

export default withCronWideEvent({
  async callback() {
    const event = WideEvent.grasp();
    event?.startTiming("fetchSources");

    const remoteSources = await database
      .select()
      .from(calendarSourcesTable)
      .where(eq(calendarSourcesTable.sourceType, ICAL_SOURCE_TYPE));
    setCronEventFields({ "source.count": remoteSources.length });

    const fetches = remoteSources.map(({ id, url }) => {
      if (!url) {
        throw new Error(`Source ${id} is missing url`);
      }
      return fetchRemoteCalendar(id, url);
    });

    const settlements = await Promise.allSettled(fetches);
    event?.endTiming("fetchSources");

    const { succeeded: fetchSucceeded, failed: fetchFailed } = countSettledResults(settlements);
    setCronEventFields({ "fetch.failed.count": fetchFailed, "fetch.succeeded.count": fetchSucceeded });

    event?.startTiming("processSnapshots");
    const insertions: Promise<SnapshotResult>[] = [];
    for (const settlement of settlements) {
      if (settlement.status === "fulfilled") {
        insertions.push(processSnapshot(settlement.value.sourceId, settlement.value.ical));
      }
    }

    const insertionResults = await Promise.all(insertions);
    event?.endTiming("processSnapshots");

    const skippedCount = insertionResults.filter(({ skipped }) => skipped).length;
    const insertErrorCount = insertionResults.filter(({ error }) => error).length;
    const insertedCount = insertionResults.length - skippedCount - insertErrorCount;

    setCronEventFields({
      "insert.error.count": insertErrorCount,
      "insert.count": insertedCount,
      "skipped.count": skippedCount,
    });
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

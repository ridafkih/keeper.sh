import type { CronOptions } from "cronbake";
import { calendarSnapshotsTable, calendarsTable } from "@keeper.sh/database/schema";
import { MS_PER_HOUR } from "@keeper.sh/constants";
import { pullRemoteCalendar } from "@keeper.sh/calendar";
import { and, desc, eq, lte } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { countSettledResults } from "../utils/count-settled-results";
import { widelog } from "../utils/logging";

const ICAL_CALENDAR_TYPE = "ical";

interface RemoteIcalSource {
  id: string;
  url: string | null;
}

interface FetchResult {
  ical: string;
  calendarId: string;
}

const fetchRemoteCalendar = async (calendarId: string, url: string): Promise<FetchResult> => {
  const { ical } = await pullRemoteCalendar("ical", url);
  return { ical, calendarId };
};

const insertSnapshot = async (
  database: BunSQLDatabase,
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
  database: BunSQLDatabase,
  calendarId: string,
  referenceDate: Date,
): Promise<void> => {
  const staleThreshold = referenceDate.getTime() - SNAPSHOT_RETENTION_MS;

  await database
    .delete(calendarSnapshotsTable)
    .where(
      and(
        eq(calendarSnapshotsTable.calendarId, calendarId),
        lte(calendarSnapshotsTable.createdAt, new Date(staleThreshold)),
      ),
    );
};

const computeContentHash = (content: string): string => Bun.hash(content).toString();

interface SnapshotResult {
  skipped: boolean;
  error: boolean;
}

const processSnapshot = async (
  database: BunSQLDatabase,
  calendarId: string,
  ical: string,
): Promise<SnapshotResult> => {
  try {
    const contentHash = computeContentHash(ical);
    const [latest] = await database
      .select({ contentHash: calendarSnapshotsTable.contentHash })
      .from(calendarSnapshotsTable)
      .where(eq(calendarSnapshotsTable.calendarId, calendarId))
      .orderBy(desc(calendarSnapshotsTable.createdAt))
      .limit(1);
    const latestHash = latest?.contentHash ?? null;

    if (latestHash === contentHash) {
      return { error: false, skipped: true };
    }

    const record = await insertSnapshot(database, { contentHash, ical, calendarId });
    if (record) {
      await deleteStaleCalendarSnapshots(database, calendarId, record.createdAt);
    }
    return { error: false, skipped: false };
  } catch (error) {
    widelog.set("ical.snapshot.error.calendar_id", calendarId);
    widelog.errorFields(error, { prefix: "ical.snapshot" });
    return { error: true, skipped: false };
  }
};

interface IcalSnapshotJobDependencies {
  getRemoteSources: () => Promise<RemoteIcalSource[]>;
  fetchRemoteCalendar: (calendarId: string, url: string) => Promise<FetchResult>;
  processSnapshot: (calendarId: string, ical: string) => Promise<SnapshotResult>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
  reportError?: (error: unknown, fields?: Record<string, unknown>) => void;
}

interface IcalSnapshotJobHooks {
  startTiming?: (name: string) => void;
  endTiming?: (name: string) => void;
}

const createMissingUrlError = (calendarId: string): Error =>
  new Error(`Source ${calendarId} is missing url`);

const createDefaultJobDependencies = (): IcalSnapshotJobDependencies => ({
  fetchRemoteCalendar,
  getRemoteSources: async () => {
    const { database } = await import("../context");
    return database
      .select({ id: calendarsTable.id, url: calendarsTable.url })
      .from(calendarsTable)
      .where(eq(calendarsTable.calendarType, ICAL_CALENDAR_TYPE));
  },
  processSnapshot: async (calendarId, ical) => {
    const { database } = await import("../context");
    return processSnapshot(database, calendarId, ical);
  },
  reportError: (error: unknown, fields?: Record<string, unknown>) => {
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          widelog.set(key, value);
        }
      }
    }
    widelog.errorFields(error);
  },
  setCronEventFields,
});

const buildFetchPromises = (
  remoteSources: RemoteIcalSource[],
  dependencies: IcalSnapshotJobDependencies,
): Promise<FetchResult>[] =>
  remoteSources.map(({ id, url }) => {
    if (!url) {
      return Promise.reject(createMissingUrlError(id));
    }
    return Promise.resolve().then(() => dependencies.fetchRemoteCalendar(id, url));
  });

const runIcalSnapshotSyncJob = async (
  dependencies: IcalSnapshotJobDependencies,
  hooks: IcalSnapshotJobHooks = {},
): Promise<void> => {
  hooks.startTiming?.("fetchSources");
  const remoteSources = await dependencies.getRemoteSources();
  dependencies.setCronEventFields({ "source.count": remoteSources.length });

  const settlements = await Promise.allSettled(buildFetchPromises(remoteSources, dependencies));
  hooks.endTiming?.("fetchSources");

  const { succeeded: fetchSucceeded, failed: fetchFailed } = countSettledResults(settlements);
  dependencies.setCronEventFields({
    "fetch.failed.count": fetchFailed,
    "fetch.succeeded.count": fetchSucceeded,
  });

  for (const [index, settlement] of settlements.entries()) {
    if (settlement.status === "rejected") {
      const source = remoteSources[index];
      dependencies.reportError?.(settlement.reason, {
        "operation.name": "ical-snapshot:fetch",
        ...(source && { "source.calendar_id": source.id }),
      });
    }
  }

  hooks.startTiming?.("processSnapshots");
  const insertionTasks: { calendarId: string; run: Promise<SnapshotResult> }[] = [];
  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      insertionTasks.push({
        calendarId: settlement.value.calendarId,
        run: Promise.resolve().then(() =>
          dependencies.processSnapshot(settlement.value.calendarId, settlement.value.ical)),
      });
    }
  }

  const insertionSettlements = await Promise.allSettled(
    insertionTasks.map((insertionTask) => insertionTask.run),
  );
  hooks.endTiming?.("processSnapshots");

  let skippedCount = 0;
  let insertErrorCount = 0;
  let insertedCount = 0;

  for (const [index, insertionSettlement] of insertionSettlements.entries()) {
    if (insertionSettlement.status === "rejected") {
      insertErrorCount += 1;
      const insertionTask = insertionTasks[index];
      dependencies.reportError?.(insertionSettlement.reason, {
        ...(insertionTask && { "source.calendar_id": insertionTask.calendarId }),
        "operation.name": "ical-snapshot:process",
      });
      continue;
    }

    if (insertionSettlement.value.error) {
      insertErrorCount += 1;
      continue;
    }

    if (insertionSettlement.value.skipped) {
      skippedCount += 1;
      continue;
    }

    insertedCount += 1;
  }

  dependencies.setCronEventFields({
    "insert.error.count": insertErrorCount,
    "insert.count": insertedCount,
    "skipped.count": skippedCount,
  });
};

export default withCronWideEvent({
  async callback() {
    const dependencies = createDefaultJobDependencies();
    await runIcalSnapshotSyncJob(dependencies, {
      endTiming: (name) => {
        widelog.time.stop(name);
      },
      startTiming: (name) => {
        widelog.time.start(name);
      },
    });
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

export { runIcalSnapshotSyncJob };

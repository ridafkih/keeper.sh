import type { SourceProjectionOutcome, SourceSyncTally } from "@keeper.sh/calendar";
import type { SyncRunRecord } from "@keeper.sh/data-schemas";
import {
  sourceDestinationMappingsTable,
  syncActivityDaysTable,
  syncActivityTable,
  syncsTable,
} from "@keeper.sh/database/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SYNC_RUN_RETENTION = 200;
const SYNC_ACTIVITY_DAY_RETENTION = 30;

type SkippedBy = SyncRunRecord["skippedBy"];
type RecordingClient = Pick<BunSQLDatabase, "execute" | "insert" | "update">;

interface DestinationPair {
  copiedCount: number;
  failedCount: number;
  id: string;
  lastErrorAt: Date | null;
  lastSyncedAt: Date | null;
  paused: boolean;
  skippedBy: SkippedBy;
  skippedCount: number;
  sourceCalendarId: string;
  syncId: string;
}

interface SyncRunRecordingInput {
  destinationCalendarId: string;
  pausedSourceCalendarIds: ReadonlySet<string>;
  readSourceCalendarIds: ReadonlySet<string>;
  sourceOutcomes: Readonly<Record<string, SourceProjectionOutcome>>;
  sourceTallies: Readonly<Record<string, SourceSyncTally>>;
}

interface PairStatus {
  copiedCount: number;
  failedCount: number;
  lastSyncedAt: Date | null;
  skippedBy: SkippedBy;
  skippedCount: number;
}

interface PairStatusUpdate extends PairStatus {
  id: string;
}

interface SyncRun {
  record: SyncRunRecord;
  syncId: string;
}

interface SyncRunPlan {
  pairUpdates: PairStatusUpdate[];
  runs: SyncRun[];
}

const EMPTY_TALLY: SourceSyncTally = { added: 0, failed: 0, removed: 0, updated: 0 };
const EMPTY_OUTCOME: SourceProjectionOutcome = { copied: 0, skipped: 0, skippedBy: {} };

const compareSkippedBy = (first: SkippedBy[number], second: SkippedBy[number]): number =>
  second.count - first.count || first.ruleId.localeCompare(second.ruleId);

const toSkippedBy = (skippedBy: SourceProjectionOutcome["skippedBy"]): SkippedBy =>
  Object.entries(skippedBy)
    .map(([ruleId, tally]) => ({ count: tally.count, name: tally.name, ruleId }))
    .toSorted(compareSkippedBy);

const mergeSkippedBy = (lists: readonly SkippedBy[]): SkippedBy => {
  const merged = new Map<string, SkippedBy[number]>();
  for (const list of lists) {
    for (const entry of list) {
      const current = merged.get(entry.ruleId) ?? { count: 0, name: entry.name, ruleId: entry.ruleId };
      current.count += entry.count;
      merged.set(entry.ruleId, current);
    }
  }
  return [...merged.values()].toSorted(compareSkippedBy);
};

const isSameSkippedBy = (first: SkippedBy, second: SkippedBy): boolean =>
  first.length === second.length
  && first.every((entry, index) => {
    const other = second[index];
    return other?.count === entry.count && other.name === entry.name && other.ruleId === entry.ruleId;
  });

const isFailing = (pair: Pick<DestinationPair, "failedCount" | "lastErrorAt">): boolean =>
  pair.failedCount > 0 || pair.lastErrorAt !== null;

// Runs that change nothing aren't logged, except the first failing run and the one that recovers.
const isWorthLogging = (record: SyncRunRecord, wasFailing: boolean): boolean =>
  record.added > 0 || record.removed > 0 || (record.failed > 0) !== wasFailing;

const resolvePairStatus = (
  pair: DestinationPair,
  input: SyncRunRecordingInput,
  syncedAt: Date,
): PairStatus => {
  const { failed } = input.sourceTallies[pair.sourceCalendarId] ?? EMPTY_TALLY;
  if (!input.readSourceCalendarIds.has(pair.sourceCalendarId)) {
    return {
      copiedCount: pair.copiedCount,
      failedCount: failed,
      lastSyncedAt: pair.lastSyncedAt,
      skippedBy: pair.skippedBy,
      skippedCount: pair.skippedCount,
    };
  }
  const outcome = input.sourceOutcomes[pair.sourceCalendarId] ?? EMPTY_OUTCOME;
  return {
    copiedCount: outcome.copied,
    failedCount: failed,
    lastSyncedAt: syncedAt,
    skippedBy: toSkippedBy(outcome.skippedBy),
    skippedCount: outcome.skipped,
  };
};

// A pair whose source was read is stamped every run, so lastSyncedAt is exact; an unread one is written only if it changed.
const needsPairWrite = (pair: DestinationPair, status: PairStatus): boolean =>
  status.lastSyncedAt !== pair.lastSyncedAt
  || pair.copiedCount !== status.copiedCount
  || pair.skippedCount !== status.skippedCount
  || pair.failedCount !== status.failedCount
  || pair.lastErrorAt !== null
  || !isSameSkippedBy(pair.skippedBy, status.skippedBy);

const planSyncRun = (
  pairs: readonly DestinationPair[],
  input: SyncRunRecordingInput,
  syncedAt: Date,
): SyncRunPlan => {
  const pairUpdates: PairStatusUpdate[] = [];
  const pairsBySyncId = new Map<string, { pair: DestinationPair; status: PairStatus }[]>();
  for (const pair of pairs) {
    if (pair.paused || input.pausedSourceCalendarIds.has(pair.sourceCalendarId)) {
      continue;
    }
    const status = resolvePairStatus(pair, input, syncedAt);
    if (needsPairWrite(pair, status)) {
      pairUpdates.push({ ...status, id: pair.id });
    }
    const syncPairs = pairsBySyncId.get(pair.syncId) ?? [];
    syncPairs.push({ pair, status });
    pairsBySyncId.set(pair.syncId, syncPairs);
  }

  const runs: SyncRun[] = [];
  for (const [syncId, syncPairs] of pairsBySyncId) {
    const record: SyncRunRecord = {
      added: 0,
      copied: 0,
      destinationCalendarId: input.destinationCalendarId,
      failed: 0,
      removed: 0,
      skipped: 0,
      skippedBy: mergeSkippedBy(syncPairs.map(({ status }) => status.skippedBy)),
    };
    for (const { pair, status } of syncPairs) {
      const tally = input.sourceTallies[pair.sourceCalendarId] ?? EMPTY_TALLY;
      record.added += tally.added;
      record.copied += status.copiedCount;
      record.failed += tally.failed;
      record.removed += tally.removed;
      record.skipped += status.skippedCount;
    }
    if (isWorthLogging(record, syncPairs.some(({ pair }) => isFailing(pair)))) {
      runs.push({ record, syncId });
    }
  }
  return { pairUpdates, runs };
};

// A destination attempt that threw is logged once, for each sync it newly leaves failing.
const planSyncFailure = (destinationCalendarId: string, pairs: readonly DestinationPair[]): SyncRun[] => {
  const pairsBySyncId = new Map<string, DestinationPair[]>();
  for (const pair of pairs) {
    pairsBySyncId.set(pair.syncId, [...(pairsBySyncId.get(pair.syncId) ?? []), pair]);
  }
  const runs: SyncRun[] = [];
  for (const [syncId, syncPairs] of pairsBySyncId) {
    if (!syncPairs.some((pair) => isFailing(pair))) {
      runs.push({
        record: {
          added: 0,
          copied: syncPairs.reduce((total, pair) => total + pair.copiedCount, 0),
          destinationCalendarId,
          failed: 1,
          removed: 0,
          skipped: syncPairs.reduce((total, pair) => total + pair.skippedCount, 0),
          skippedBy: mergeSkippedBy(syncPairs.map((pair) => pair.skippedBy)),
        },
        syncId,
      });
    }
  }
  return runs;
};

const readDestinationPairs = (
  database: BunSQLDatabase,
  destinationCalendarId: string,
): Promise<DestinationPair[]> =>
  database
    .select({
      copiedCount: sourceDestinationMappingsTable.copiedCount,
      failedCount: sourceDestinationMappingsTable.failedCount,
      id: sourceDestinationMappingsTable.id,
      lastErrorAt: sourceDestinationMappingsTable.lastErrorAt,
      lastSyncedAt: sourceDestinationMappingsTable.lastSyncedAt,
      paused: syncsTable.paused,
      skippedBy: sourceDestinationMappingsTable.skippedBy,
      skippedCount: sourceDestinationMappingsTable.skippedCount,
      sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
      syncId: sourceDestinationMappingsTable.syncId,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(syncsTable, eq(sourceDestinationMappingsTable.syncId, syncsTable.id))
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

const writePairStatuses = async (
  client: RecordingClient,
  updates: readonly PairStatusUpdate[],
): Promise<void> => {
  if (updates.length === 0) {
    return;
  }
  await client.execute(sql`
    UPDATE ${sourceDestinationMappingsTable} AS pair
    SET "copiedCount" = status."copiedCount",
        "failedCount" = status."failedCount",
        "lastErrorAt" = NULL,
        "lastSyncedAt" = status."lastSyncedAt",
        "skippedBy" = status."skippedBy",
        "skippedCount" = status."skippedCount"
    FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS status(
      "id" uuid,
      "copiedCount" integer,
      "failedCount" integer,
      "lastSyncedAt" timestamptz,
      "skippedBy" jsonb,
      "skippedCount" integer
    )
    WHERE pair."id" = status."id"
  `);
};

const addToActivityDays = async (client: RecordingClient, runs: readonly SyncRun[]): Promise<void> => {
  const totals = runs
    .filter(({ record }) => record.added > 0 || record.removed > 0)
    .map(({ record, syncId }) => ({ added: record.added, removed: record.removed, syncId }));
  if (totals.length === 0) {
    return;
  }
  const rows = JSON.stringify(totals);
  await client.execute(sql`
    WITH pruned AS (
      DELETE FROM ${syncActivityDaysTable}
      WHERE "syncId" IN (SELECT "syncId" FROM jsonb_to_recordset(${rows}::jsonb) AS total("syncId" uuid))
        AND "day" < (now() AT TIME ZONE 'utc')::date - ${SYNC_ACTIVITY_DAY_RETENTION}::integer
    )
    INSERT INTO ${syncActivityDaysTable} ("syncId", "day", "added", "removed")
    SELECT total."syncId", (now() AT TIME ZONE 'utc')::date, total."added", total."removed"
    FROM jsonb_to_recordset(${rows}::jsonb) AS total("syncId" uuid, "added" integer, "removed" integer)
    ON CONFLICT ("syncId", "day") DO UPDATE
    SET "added" = ${syncActivityDaysTable}."added" + excluded."added",
        "removed" = ${syncActivityDaysTable}."removed" + excluded."removed"
  `);
};

const pruneSyncRuns = async (client: RecordingClient, syncIds: readonly string[]): Promise<void> => {
  await client.execute(sql`
    DELETE FROM ${syncActivityTable}
    WHERE "id" IN (
      SELECT ranked."id" FROM (
        SELECT "id", row_number() OVER (PARTITION BY "syncId" ORDER BY "createdAt" DESC, "id" DESC) AS position
        FROM ${syncActivityTable}
        WHERE "kind" = 'run' AND ${inArray(syncActivityTable.syncId, [...syncIds])}
      ) AS ranked
      WHERE ranked.position > ${SYNC_RUN_RETENTION}
    )
  `);
};

const logSyncRuns = async (client: RecordingClient, runs: readonly SyncRun[]): Promise<void> => {
  await client
    .insert(syncActivityTable)
    .values(runs.map(({ record, syncId }) => ({ kind: "run", payload: { ...record }, syncId })));
  await addToActivityDays(client, runs);
  await pruneSyncRuns(client, runs.map(({ syncId }) => syncId));
};

const recordSyncRun = async (database: BunSQLDatabase, input: SyncRunRecordingInput): Promise<void> => {
  const pairs = await readDestinationPairs(database, input.destinationCalendarId);
  const plan = planSyncRun(pairs, input, new Date());
  if (plan.runs.length === 0) {
    await writePairStatuses(database, plan.pairUpdates);
    return;
  }
  await database.transaction(async (transaction) => {
    await writePairStatuses(transaction, plan.pairUpdates);
    await logSyncRuns(transaction, plan.runs);
  });
};

const recordSyncFailure = async (database: BunSQLDatabase, destinationCalendarId: string): Promise<void> => {
  const destinationPairs = await readDestinationPairs(database, destinationCalendarId);
  const pairs = destinationPairs.filter((pair) => !pair.paused);
  const newlyFailing = pairs.filter((pair) => pair.lastErrorAt === null);
  if (newlyFailing.length === 0) {
    return;
  }
  const runs = planSyncFailure(destinationCalendarId, pairs);
  const stampFailure = (client: RecordingClient) =>
    client
      .update(sourceDestinationMappingsTable)
      .set({ lastErrorAt: sql`now()` })
      .where(inArray(sourceDestinationMappingsTable.id, newlyFailing.map((pair) => pair.id)));
  if (runs.length === 0) {
    await stampFailure(database);
    return;
  }
  await database.transaction(async (transaction) => {
    await stampFailure(transaction);
    await logSyncRuns(transaction, runs);
  });
};

export { isWorthLogging, planSyncFailure, planSyncRun, recordSyncFailure, recordSyncRun };
export type { DestinationPair, SyncRunRecordingInput };

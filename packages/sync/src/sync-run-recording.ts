import type { SourceProjectionOutcome } from "@keeper.sh/calendar";
import type { SyncRunRecord } from "@keeper.sh/data-schemas";
import { sourceDestinationMappingsTable, syncActivityTable } from "@keeper.sh/database/schema";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SYNC_ACTIVITY_RETENTION = 200;

interface DestinationPair {
  id: string;
  sourceCalendarId: string;
  syncId: string;
}

interface DestinationRunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface SyncRunRecordingInput {
  destinationCalendarId: string;
  pausedSourceCalendarIds: ReadonlySet<string>;
  result: DestinationRunResult;
  sourceOutcomes: Readonly<Record<string, SourceProjectionOutcome>>;
}

const mergeSkippedBy = (outcomes: readonly SourceProjectionOutcome[]): SyncRunRecord["skippedBy"] => {
  const merged = new Map<string, { count: number; name: string; ruleId: string }>();
  for (const outcome of outcomes) {
    for (const [ruleId, tally] of Object.entries(outcome.skippedBy)) {
      const current = merged.get(ruleId) ?? { count: 0, name: tally.name, ruleId };
      current.count += tally.count;
      merged.set(ruleId, current);
    }
  }
  return [...merged.values()].toSorted((first, second) => second.count - first.count);
};

// Adds and removes are only known per destination, so a destination fed by several syncs reports its whole run to each.
const buildSyncRunRecords = (
  pairs: readonly DestinationPair[],
  input: SyncRunRecordingInput,
): Map<string, SyncRunRecord> => {
  const activePairs = pairs.filter((pair) => !input.pausedSourceCalendarIds.has(pair.sourceCalendarId));
  const outcomesBySyncId = new Map<string, SourceProjectionOutcome[]>();
  for (const pair of activePairs) {
    const outcomes = outcomesBySyncId.get(pair.syncId) ?? [];
    outcomes.push(input.sourceOutcomes[pair.sourceCalendarId] ?? { copied: 0, skipped: 0, skippedBy: {} });
    outcomesBySyncId.set(pair.syncId, outcomes);
  }

  const records = new Map<string, SyncRunRecord>();
  for (const [syncId, outcomes] of outcomesBySyncId) {
    records.set(syncId, {
      added: input.result.added,
      copied: outcomes.reduce((total, outcome) => total + outcome.copied, 0),
      destinationCalendarId: input.destinationCalendarId,
      failed: input.result.addFailed + input.result.removeFailed,
      removed: input.result.removed,
      sharedDestination: outcomesBySyncId.size > 1,
      skipped: outcomes.reduce((total, outcome) => total + outcome.skipped, 0),
      skippedBy: mergeSkippedBy(outcomes),
    });
  }
  return records;
};

const isWorthLogging = (record: SyncRunRecord, previous: SyncRunRecord | null): boolean => {
  if (record.added > 0 || record.removed > 0) {
    return true;
  }
  if (record.failed === 0) {
    return Boolean(previous && previous.failed > 0);
  }
  return !previous || previous.failed === 0;
};

const isSyncRunRecord = (payload: unknown): payload is SyncRunRecord =>
  typeof payload === "object" && payload !== null && "failed" in payload && "destinationCalendarId" in payload;

const findPreviousRun = async (
  database: BunSQLDatabase,
  syncId: string,
  destinationCalendarId: string,
): Promise<SyncRunRecord | null> => {
  const runs = await database
    .select({ payload: syncActivityTable.payload })
    .from(syncActivityTable)
    .where(and(eq(syncActivityTable.syncId, syncId), eq(syncActivityTable.kind, "run")))
    .orderBy(desc(syncActivityTable.createdAt), desc(syncActivityTable.id))
    .limit(SYNC_ACTIVITY_RETENTION);
  const previous = runs.find(({ payload }) =>
    isSyncRunRecord(payload) && payload.destinationCalendarId === destinationCalendarId);
  if (previous && isSyncRunRecord(previous.payload)) {
    return previous.payload;
  }
  return null;
};

const pruneSyncActivity = async (database: BunSQLDatabase, syncId: string): Promise<void> => {
  const kept = database
    .select({ id: syncActivityTable.id })
    .from(syncActivityTable)
    .where(eq(syncActivityTable.syncId, syncId))
    .orderBy(desc(syncActivityTable.createdAt), desc(syncActivityTable.id))
    .limit(SYNC_ACTIVITY_RETENTION);
  await database
    .delete(syncActivityTable)
    .where(and(eq(syncActivityTable.syncId, syncId), notInArray(syncActivityTable.id, kept)));
};

const updatePairStatus = async (
  database: BunSQLDatabase,
  pairs: readonly DestinationPair[],
  input: SyncRunRecordingInput,
  syncedAt: Date,
): Promise<void> => {
  for (const pair of pairs) {
    if (!input.pausedSourceCalendarIds.has(pair.sourceCalendarId)) {
      const outcome = input.sourceOutcomes[pair.sourceCalendarId];
      await database
        .update(sourceDestinationMappingsTable)
        .set({ copiedCount: outcome?.copied ?? 0, lastSyncedAt: syncedAt, skippedCount: outcome?.skipped ?? 0 })
        .where(eq(sourceDestinationMappingsTable.id, pair.id));
    }
  }
};

const recordSyncRun = async (database: BunSQLDatabase, input: SyncRunRecordingInput): Promise<void> => {
  const pairs = await database
    .select({
      id: sourceDestinationMappingsTable.id,
      sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
      syncId: sourceDestinationMappingsTable.syncId,
    })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, input.destinationCalendarId));
  if (pairs.length === 0) {
    return;
  }

  await updatePairStatus(database, pairs, input, new Date());
  const records = buildSyncRunRecords(pairs, input);
  const logged: string[] = [];
  for (const [syncId, record] of records) {
    const previous = await findPreviousRun(database, syncId, input.destinationCalendarId);
    if (isWorthLogging(record, previous)) {
      await database.insert(syncActivityTable).values({ kind: "run", payload: { ...record }, syncId });
      logged.push(syncId);
    }
  }
  for (const syncId of logged) {
    await pruneSyncActivity(database, syncId);
  }
};

export { buildSyncRunRecords, isWorthLogging, recordSyncRun };
export type { DestinationPair, DestinationRunResult, SyncRunRecordingInput };

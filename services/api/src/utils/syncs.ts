import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
  syncActivityDaysTable,
  syncActivityTable,
  syncCalendarsTable,
  syncStatusTable,
  syncsTable,
} from "@keeper.sh/database/schema";
import {
  DEFAULT_SYNC_SETTINGS,
  addsProSettings,
  deriveSyncPairs,
  diffSyncChanges,
  normalizeAdvancedRules,
  normalizeSkipAvailabilities,
  normalizeSkipKeywords,
  normalizeSyncCalendars,
  resolveSyncState,
  sameCalendars,
  syncCalendarIds,
  toShareAs,
  toSyncMode,
  validateSyncCalendarLimit,
  validateSyncCalendars,
} from "@keeper.sh/data-schemas";
import type {
  AdvancedRule,
  CreateSyncBody,
  PatchSyncBody,
  SyncActivityEntry,
  SyncActivityPage,
  SyncActivitySummary,
  SyncCalendarProblem,
  SyncCalendarRole,
  SyncCalendars,
  SyncChange,
  SyncConflict,
  SyncDefinition,
  SyncDestinationStatus,
  SyncDetail,
  SyncPair,
  SyncRunRecord,
  SyncSourceStatus,
  SyncSummary,
} from "@keeper.sh/data-schemas";
import { and, asc, desc, eq, getTableColumns, inArray, lt, or, sql } from "drizzle-orm";
import type { database as databaseInstance } from "@/context";
import {
  USER_MAPPING_LOCK_NAMESPACE,
  requestUserSync,
  scheduleMappingReplacementSync,
  withMappingMutationLocks,
} from "./source-destination-mappings";

const SYNC_LIMIT_ERROR_MESSAGE = "Free plans include one sync. Upgrade to Keeper.sh Pro for unlimited syncs.";
const SYNC_CONTENT_ERROR_MESSAGE = "This setting requires a Pro plan.";
const SYNC_NOT_FOUND_ERROR_MESSAGE = "Sync not found.";
const SYNC_CALENDARS_NOT_FOUND_ERROR_MESSAGE = "Some calendars were not found.";
const SYNC_STALE_ERROR_MESSAGE = "This sync changed since you opened it.";
const DEFAULT_ACTIVITY_PAGE_SIZE = 50;
const MAX_ACTIVITY_PAGE_SIZE = 100;
const ACTIVITY_SUMMARY_DAYS = 7;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];
type ReadClient = Pick<DatabaseClient, "select">;

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

const joinNames = (names: readonly string[]): string => {
  const last = names.at(-1) ?? "";
  if (names.length < 2) {
    return last;
  }
  return `${names.slice(0, -1).join(", ")} and ${last}`;
};

const describeConflicts = (conflicts: readonly SyncConflict[]): string => {
  const names = [...new Map(conflicts.map((conflict) => [conflict.syncId, conflict.syncName])).values()];
  return `Some calendars already copy into each other through ${joinNames(names)}.`;
};

class SyncLimitError extends Error {}
class SyncContentNotAllowedError extends Error {}
class SyncNotFoundError extends Error {}
class SyncStaleError extends Error {}
class SyncValidationError extends Error {}
class SyncConflictError extends Error {
  readonly conflicts: SyncConflict[];

  constructor(conflicts: SyncConflict[]) {
    super(describeConflicts(conflicts));
    this.conflicts = conflicts;
  }
}

interface OwnedCalendar {
  capabilities: string[];
  id: string;
}

interface StoredSync extends SyncDefinition {
  updatedAt: string;
}

type SyncBody = CreateSyncBody | PatchSyncBody;

const createRuleId = (): string => crypto.randomUUID();

const pickCalendars = (current: SyncCalendars, body: SyncBody): SyncCalendars => normalizeSyncCalendars({
  destinationCalendarIds: body.destinationCalendarIds ?? current.destinationCalendarIds,
  memberCalendarIds: body.memberCalendarIds ?? current.memberCalendarIds,
  mode: body.mode ?? current.mode,
  sourceCalendarIds: body.sourceCalendarIds ?? current.sourceCalendarIds,
});

const pickBusyTitle = (current: string | null, body: SyncBody): string | null => {
  if (!("busyTitle" in body)) {
    return current;
  }
  return body.busyTitle?.trim() || null;
};

const pickRules = (current: AdvancedRule[], body: SyncBody): AdvancedRule[] => {
  if (!body.rules) {
    return current;
  }
  return normalizeAdvancedRules(body.rules, createRuleId);
};

// A patch replaces calendars and rules wholesale; every other field falls back to what the sync already has.
const mergeSyncDefinition = (current: SyncDefinition, body: SyncBody): SyncDefinition => ({
  ...pickCalendars(current, body),
  busyTitle: pickBusyTitle(current.busyTitle, body),
  markPrivate: body.markPrivate ?? current.markPrivate,
  name: body.name?.trim() ?? current.name,
  paused: body.paused ?? current.paused,
  rules: pickRules(current.rules, body),
  shareAs: body.shareAs ?? current.shareAs,
  skipAllDay: body.skipAllDay ?? current.skipAllDay,
  skipAvailabilities: normalizeSkipAvailabilities(body.skipAvailabilities ?? current.skipAvailabilities),
  skipFocusTime: body.skipFocusTime ?? current.skipFocusTime,
  skipOutOfOffice: body.skipOutOfOffice ?? current.skipOutOfOffice,
  skipTitleKeywords: normalizeSkipKeywords(body.skipTitleKeywords ?? current.skipTitleKeywords),
});

const EMPTY_SYNC_DEFINITION: SyncDefinition = {
  ...DEFAULT_SYNC_SETTINGS,
  destinationCalendarIds: [],
  memberCalendarIds: [],
  mode: "one_way",
  name: "",
  paused: false,
  sourceCalendarIds: [],
};

const assertSyncContentAllowed = async (
  canUseEventFilters: () => Promise<boolean>,
  current: SyncDefinition | null,
  next: SyncDefinition,
): Promise<void> => {
  if (addsProSettings(current, next) && !(await canUseEventFilters())) {
    throw new SyncContentNotAllowedError(SYNC_CONTENT_ERROR_MESSAGE);
  }
};

const assertWithinCalendarLimit = (next: SyncCalendars, current: SyncCalendars | null, limit: number): void => {
  const error = validateSyncCalendarLimit(next, current, limit);
  if (error) {
    throw new SyncLimitError(error);
  }
};

const ROLE_CAPABILITIES: Record<SyncCalendarRole, string[]> = {
  destination: ["push"],
  member: ["pull", "push"],
  source: ["pull"],
};

const calendarRoleEntries = (calendars: SyncCalendars): [string, SyncCalendarRole][] => [
  ...calendars.sourceCalendarIds.map((calendarId): [string, SyncCalendarRole] => [calendarId, "source"]),
  ...calendars.destinationCalendarIds.map((calendarId): [string, SyncCalendarRole] => [calendarId, "destination"]),
  ...calendars.memberCalendarIds.map((calendarId): [string, SyncCalendarRole] => [calendarId, "member"]),
];

const assertCalendarsUsable = (calendars: SyncCalendars, owned: readonly OwnedCalendar[]): void => {
  const capabilitiesById = new Map(owned.map((calendar) => [calendar.id, calendar.capabilities]));
  for (const [calendarId, role] of calendarRoleEntries(calendars)) {
    const capabilities = capabilitiesById.get(calendarId);
    if (!capabilities) {
      throw new SyncValidationError(SYNC_CALENDARS_NOT_FOUND_ERROR_MESSAGE);
    }
    if (!ROLE_CAPABILITIES[role].every((capability) => capabilities.includes(capability))) {
      throw new SyncValidationError(`A calendar in this sync can't be used as a ${role}.`);
    }
  }
};

const assertValidDefinition = (definition: SyncDefinition): void => {
  const error = validateSyncCalendars(definition);
  if (error) {
    throw new SyncValidationError(error);
  }
};

interface SyncWriteTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  countUserSyncs: (userId: string) => Promise<number>;
  ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
  findOwnedCalendars: (userId: string, calendarIds: string[]) => Promise<OwnedCalendar[]>;
  findPairConflicts: (userId: string, syncId: string | null, pairs: SyncPair[]) => Promise<SyncConflict[]>;
  findSync: (userId: string, syncId: string) => Promise<StoredSync | null>;
  insertActivity: (syncId: string, changes: SyncChange[]) => Promise<void>;
  insertSync: (userId: string, definition: SyncDefinition) => Promise<string>;
  replaceSyncCalendars: (syncId: string, calendars: SyncCalendars) => Promise<void>;
  replaceSyncPairs: (syncId: string, pairs: SyncPair[]) => Promise<void>;
  requestUserSync: (userId: string) => Promise<void>;
  updateSync: (syncId: string, definition: SyncDefinition) => Promise<void>;
}

interface SyncWriteDependencies {
  canAddSync: (userId: string, currentCount: number) => Promise<boolean>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
  getSyncCalendarLimit: (userId: string) => Promise<number>;
  withTransaction: <TResult>(callback: (transaction: SyncWriteTransaction) => Promise<TResult>) => Promise<TResult>;
}

const writeCalendarsAndPairs = async (
  transaction: SyncWriteTransaction,
  userId: string,
  syncId: string | null,
  definition: SyncDefinition,
): Promise<SyncPair[]> => {
  const owned = await transaction.findOwnedCalendars(userId, syncCalendarIds(definition));
  assertCalendarsUsable(definition, owned);
  const pairs = deriveSyncPairs(definition);
  const conflicts = await transaction.findPairConflicts(userId, syncId, pairs);
  if (conflicts.length > 0) {
    throw new SyncConflictError(conflicts);
  }
  return pairs;
};

const persistPairs = async (
  transaction: SyncWriteTransaction,
  syncId: string,
  definition: SyncDefinition,
  pairs: SyncPair[],
): Promise<void> => {
  await transaction.replaceSyncCalendars(syncId, definition);
  await transaction.replaceSyncPairs(syncId, pairs);
  await transaction.ensureDestinationSyncStatuses([...new Set(pairs.map((pair) => pair.destinationCalendarId))]);
};

const runCreateSync = async (
  userId: string,
  body: CreateSyncBody,
  dependencies: SyncWriteDependencies,
): Promise<string> => {
  const definition = mergeSyncDefinition(EMPTY_SYNC_DEFINITION, body);
  assertValidDefinition(definition);
  await assertSyncContentAllowed(() => dependencies.canUseEventFilters(userId), null, definition);
  assertWithinCalendarLimit(definition, null, await dependencies.getSyncCalendarLimit(userId));

  return await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(userId);
    const currentCount = await transaction.countUserSyncs(userId);
    if (!(await dependencies.canAddSync(userId, currentCount))) {
      throw new SyncLimitError(SYNC_LIMIT_ERROR_MESSAGE);
    }
    const pairs = await writeCalendarsAndPairs(transaction, userId, null, definition);
    const syncId = await transaction.insertSync(userId, definition);
    await persistPairs(transaction, syncId, definition, pairs);
    await transaction.insertActivity(syncId, diffSyncChanges(null, definition));
    await transaction.requestUserSync(userId);
    return syncId;
  });
};

const isSyncWideChange = (changes: readonly SyncChange[]): boolean =>
  changes.some((change) => change.kind !== "renamed");

// Calendars are only checked when they change, so a sync a calendar deletion emptied can still be renamed or paused.
const runUpdateSync = async (
  userId: string,
  syncId: string,
  body: PatchSyncBody,
  dependencies: SyncWriteDependencies,
): Promise<SyncChange[]> => await dependencies.withTransaction(async (transaction) => {
  await transaction.acquireUserLock(userId);
  const current = await transaction.findSync(userId, syncId);
  if (!current) {
    throw new SyncNotFoundError(SYNC_NOT_FOUND_ERROR_MESSAGE);
  }
  if (typeof body.expectedUpdatedAt === "string" && body.expectedUpdatedAt !== current.updatedAt) {
    throw new SyncStaleError(SYNC_STALE_ERROR_MESSAGE);
  }
  const next = mergeSyncDefinition(current, body);
  const calendarsChanged = !sameCalendars(current, next);
  if (calendarsChanged) {
    assertValidDefinition(next);
    assertWithinCalendarLimit(next, current, await dependencies.getSyncCalendarLimit(userId));
  }
  await assertSyncContentAllowed(() => dependencies.canUseEventFilters(userId), current, next);

  const changes = diffSyncChanges(current, next);
  if (changes.length === 0) {
    return changes;
  }
  if (calendarsChanged) {
    const pairs = await writeCalendarsAndPairs(transaction, userId, syncId, next);
    await persistPairs(transaction, syncId, next, pairs);
  }
  await transaction.updateSync(syncId, next);
  await transaction.insertActivity(syncId, changes);
  if (isSyncWideChange(changes)) {
    await transaction.requestUserSync(userId);
  }
  return changes;
});

const acquireUserSyncLock = async (client: DatabaseTransactionClient, userId: string): Promise<void> => {
  await client.execute(sql`select pg_advisory_xact_lock(${USER_MAPPING_LOCK_NAMESPACE}, hashtext(${userId}))`);
};

const readSyncCalendars = async (client: ReadClient, syncIds: string[]): Promise<Map<string, SyncCalendars>> => {
  const calendarsBySyncId = new Map<string, SyncCalendars>();
  if (syncIds.length === 0) {
    return calendarsBySyncId;
  }
  const rows = await client
    .select({ calendarId: syncCalendarsTable.calendarId, role: syncCalendarsTable.role, syncId: syncCalendarsTable.syncId })
    .from(syncCalendarsTable)
    .where(inArray(syncCalendarsTable.syncId, syncIds))
    .orderBy(asc(syncCalendarsTable.position));
  for (const row of rows) {
    const calendars = calendarsBySyncId.get(row.syncId)
      ?? { destinationCalendarIds: [], memberCalendarIds: [], mode: "one_way", sourceCalendarIds: [] };
    if (row.role === "source") {
      calendars.sourceCalendarIds.push(row.calendarId);
    }
    if (row.role === "destination") {
      calendars.destinationCalendarIds.push(row.calendarId);
    }
    if (row.role === "member") {
      calendars.memberCalendarIds.push(row.calendarId);
    }
    calendarsBySyncId.set(row.syncId, calendars);
  }
  return calendarsBySyncId;
};

type SyncRow = typeof syncsTable.$inferSelect;

const toDefinition = (row: SyncRow, calendars: SyncCalendars | undefined): SyncDefinition => ({
  busyTitle: row.busyTitle,
  destinationCalendarIds: calendars?.destinationCalendarIds ?? [],
  markPrivate: row.markPrivate,
  memberCalendarIds: calendars?.memberCalendarIds ?? [],
  mode: toSyncMode(row.mode),
  name: row.name,
  paused: row.paused,
  rules: row.rules,
  shareAs: toShareAs(row.shareAs),
  skipAllDay: row.skipAllDay,
  skipAvailabilities: normalizeSkipAvailabilities(row.skipAvailabilities),
  skipFocusTime: row.skipFocusTime,
  skipOutOfOffice: row.skipOutOfOffice,
  skipTitleKeywords: row.skipTitleKeywords,
  sourceCalendarIds: calendars?.sourceCalendarIds ?? [],
});

const findSyncForUser = async (client: ReadClient, userId: string, syncId: string): Promise<StoredSync | null> => {
  if (!isUuid(syncId)) {
    return null;
  }
  const [row] = await client
    .select()
    .from(syncsTable)
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
    .limit(1);
  if (!row) {
    return null;
  }
  const calendars = await readSyncCalendars(client, [row.id]);
  return { ...toDefinition(row, calendars.get(row.id)), updatedAt: row.updatedAt.toISOString() };
};

const toSyncColumns = (definition: SyncDefinition) => ({
  busyTitle: definition.busyTitle,
  markPrivate: definition.markPrivate,
  mode: definition.mode,
  name: definition.name,
  paused: definition.paused,
  rules: definition.rules,
  shareAs: definition.shareAs,
  skipAllDay: definition.skipAllDay,
  skipAvailabilities: definition.skipAvailabilities,
  skipFocusTime: definition.skipFocusTime,
  skipOutOfOffice: definition.skipOutOfOffice,
  skipTitleKeywords: definition.skipTitleKeywords,
});

const pairKey = (pair: SyncPair): string => `${pair.sourceCalendarId}::${pair.destinationCalendarId}`;

const createSyncWriteTransaction = (client: DatabaseTransactionClient): SyncWriteTransaction => ({
  acquireUserLock: (userId) => acquireUserSyncLock(client, userId),
  countUserSyncs: async (userId) => {
    const [result] = await client.select({ value: sql<number>`count(*)` }).from(syncsTable).where(eq(syncsTable.userId, userId));
    return Number(result?.value ?? 0);
  },
  ensureDestinationSyncStatuses: async (destinationCalendarIds) => {
    if (destinationCalendarIds.length === 0) {
      return;
    }
    await client
      .insert(syncStatusTable)
      .values(destinationCalendarIds.map((calendarId) => ({ calendarId })))
      .onConflictDoNothing();
  },
  findOwnedCalendars: async (userId, calendarIds) => {
    if (calendarIds.length === 0) {
      return [];
    }
    return await client
      .select({ capabilities: calendarsTable.capabilities, id: calendarsTable.id })
      .from(calendarsTable)
      .where(and(eq(calendarsTable.userId, userId), inArray(calendarsTable.id, calendarIds)));
  },
  findPairConflicts: async (userId, syncId, pairs) => {
    if (pairs.length === 0) {
      return [];
    }
    const wanted = new Set(pairs.map((pair) => pairKey(pair)));
    const rows = await client
      .select({
        destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
        sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
        syncId: syncsTable.id,
        syncName: syncsTable.name,
      })
      .from(sourceDestinationMappingsTable)
      .innerJoin(syncsTable, eq(sourceDestinationMappingsTable.syncId, syncsTable.id))
      .where(and(
        eq(syncsTable.userId, userId),
        inArray(sourceDestinationMappingsTable.sourceCalendarId, [...new Set(pairs.map((pair) => pair.sourceCalendarId))]),
        inArray(sourceDestinationMappingsTable.destinationCalendarId, [...new Set(pairs.map((pair) => pair.destinationCalendarId))]),
      ));
    return rows.filter((row) => row.syncId !== syncId && wanted.has(pairKey(row)));
  },
  findSync: (userId, syncId) => findSyncForUser(client, userId, syncId),
  insertActivity: async (syncId, changes) => {
    if (changes.length === 0) {
      return;
    }
    await client.insert(syncActivityTable).values(changes.map((change) => ({ kind: "change", payload: { ...change }, syncId })));
  },
  insertSync: async (userId, definition) => {
    const [inserted] = await client
      .insert(syncsTable)
      .values({ ...toSyncColumns(definition), userId })
      .returning({ id: syncsTable.id });
    if (!inserted) {
      throw new Error("Failed to create sync");
    }
    return inserted.id;
  },
  replaceSyncCalendars: async (syncId, calendars) => {
    await client.delete(syncCalendarsTable).where(eq(syncCalendarsTable.syncId, syncId));
    const positions = new Map<SyncCalendarRole, number>();
    const rows = calendarRoleEntries(calendars).map(([calendarId, role]) => {
      const position = positions.get(role) ?? 0;
      positions.set(role, position + 1);
      return { calendarId, position, role, syncId };
    });
    if (rows.length > 0) {
      await client.insert(syncCalendarsTable).values(rows);
    }
  },
  replaceSyncPairs: async (syncId, pairs) => {
    const existing = await client
      .select({
        destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
        id: sourceDestinationMappingsTable.id,
        sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
      })
      .from(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.syncId, syncId));
    const wanted = new Set(pairs.map((pair) => pairKey(pair)));
    const kept = new Set(existing.map((pair) => pairKey(pair)));
    const removedIds = existing.filter((pair) => !wanted.has(pairKey(pair))).map((pair) => pair.id);
    const added = pairs.filter((pair) => !kept.has(pairKey(pair)));
    if (removedIds.length > 0) {
      await client.delete(sourceDestinationMappingsTable).where(inArray(sourceDestinationMappingsTable.id, removedIds));
    }
    if (added.length > 0) {
      await client.insert(sourceDestinationMappingsTable).values(added.map((pair) => ({ ...pair, syncId })));
    }
  },
  requestUserSync: (userId) => requestUserSync(client, userId),
  updateSync: async (syncId, definition) => {
    await client.update(syncsTable).set(toSyncColumns(definition)).where(eq(syncsTable.id, syncId));
  },
});

const createSyncWriteDependencies = async (): Promise<SyncWriteDependencies> => {
  const { database, premiumService } = await import("@/context");
  return {
    canAddSync: (userId, currentCount) => premiumService.canAddSync(userId, currentCount),
    canUseEventFilters: (userId) => premiumService.canUseEventFilters(userId),
    getSyncCalendarLimit: (userId) => premiumService.getUserSyncCalendarLimit(userId),
    withTransaction: (callback) => database.transaction((client) => callback(createSyncWriteTransaction(client))),
  };
};

const findSyncDestinationIds = async (client: ReadClient, userId: string, syncId: string): Promise<string[]> => {
  const rows = await client
    .select({ destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId })
    .from(sourceDestinationMappingsTable)
    .innerJoin(syncsTable, eq(sourceDestinationMappingsTable.syncId, syncsTable.id))
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)));
  return rows.map((row) => row.destinationCalendarId);
};

const findOwnedRequestedDestinationIds = async (client: ReadClient, userId: string, body: SyncBody): Promise<string[]> => {
  const requested = [...(body.destinationCalendarIds ?? []), ...(body.memberCalendarIds ?? [])];
  if (requested.length === 0) {
    return [];
  }
  const owned = await client
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(and(eq(calendarsTable.userId, userId), inArray(calendarsTable.id, requested)));
  return owned.map((calendar) => calendar.id);
};

const deleteSyncRow = async (client: DatabaseTransactionClient, userId: string, syncId: string): Promise<boolean> => {
  await acquireUserSyncLock(client, userId);
  const [deleted] = await client
    .delete(syncsTable)
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
    .returning({ id: syncsTable.id });
  if (!deleted) {
    return false;
  }
  await requestUserSync(client, userId);
  return true;
};

interface SyncLockDependencies {
  deleteSync: (userId: string, syncId: string) => Promise<boolean>;
  findOwnedDestinationIds: (userId: string, body: SyncBody) => Promise<string[]>;
  findSyncDestinationIds: (userId: string, syncId: string) => Promise<string[]>;
  scheduleSync: (userId: string) => void;
  withLocks: <TResult>(
    userId: string,
    resolveDestinationCalendarIds: () => Promise<string[]>,
    callback: () => Promise<TResult>,
  ) => Promise<{ destinationCalendarIds: string[]; result: TResult }>;
}

const createSyncLockDependencies = async (): Promise<SyncLockDependencies> => {
  const { database } = await import("@/context");
  return {
    deleteSync: (userId, syncId) => database.transaction((client) => deleteSyncRow(client, userId, syncId)),
    findOwnedDestinationIds: (userId, body) => findOwnedRequestedDestinationIds(database, userId, body),
    findSyncDestinationIds: (userId, syncId) => findSyncDestinationIds(database, userId, syncId),
    scheduleSync: scheduleMappingReplacementSync,
    withLocks: withMappingMutationLocks,
  };
};

const isRenameOnly = (body: PatchSyncBody): boolean =>
  Object.keys(body).every((key) => key === "name" || key === "expectedUpdatedAt");

// Destinations are locked before the write, from both the old and the new pairs, so no push races the change.
const runLockedCreateSync = async (
  userId: string,
  body: CreateSyncBody,
  writes: SyncWriteDependencies,
  locks: SyncLockDependencies,
): Promise<string> => {
  const { result } = await locks.withLocks(
    userId,
    () => locks.findOwnedDestinationIds(userId, body),
    () => runCreateSync(userId, body, writes),
  );
  locks.scheduleSync(userId);
  return result;
};

const runLockedUpdateSync = async (
  userId: string,
  syncId: string,
  body: PatchSyncBody,
  writes: SyncWriteDependencies,
  locks: SyncLockDependencies,
): Promise<void> => {
  if (isRenameOnly(body)) {
    await runUpdateSync(userId, syncId, body, writes);
    return;
  }
  const { result } = await locks.withLocks(
    userId,
    async () => [
      ...await locks.findSyncDestinationIds(userId, syncId),
      ...await locks.findOwnedDestinationIds(userId, body),
    ],
    () => runUpdateSync(userId, syncId, body, writes),
  );
  if (isSyncWideChange(result)) {
    locks.scheduleSync(userId);
  }
};

const runLockedDeleteSync = async (userId: string, syncId: string, locks: SyncLockDependencies): Promise<void> => {
  await locks.withLocks(
    userId,
    () => locks.findSyncDestinationIds(userId, syncId),
    async () => {
      if (!(await locks.deleteSync(userId, syncId))) {
        throw new SyncNotFoundError(SYNC_NOT_FOUND_ERROR_MESSAGE);
      }
    },
  );
  locks.scheduleSync(userId);
};

const createSync = async (userId: string, body: CreateSyncBody): Promise<string> =>
  await runLockedCreateSync(userId, body, await createSyncWriteDependencies(), await createSyncLockDependencies());

const updateSync = async (userId: string, syncId: string, body: PatchSyncBody): Promise<void> => {
  await runLockedUpdateSync(userId, syncId, body, await createSyncWriteDependencies(), await createSyncLockDependencies());
};

const deleteSync = async (userId: string, syncId: string): Promise<void> => {
  await runLockedDeleteSync(userId, syncId, await createSyncLockDependencies());
};

interface PairStatusRow {
  copiedCount: number;
  destinationCalendarId: string;
  disabled: boolean;
  failureCount: number;
  lastErrorAt: Date | null;
  lastSyncedAt: Date | null;
  needsReauthentication: boolean;
  skippedCount: number;
  syncId: string;
}

const readPairStatuses = async (client: ReadClient, syncIds: string[]): Promise<PairStatusRow[]> => {
  if (syncIds.length === 0) {
    return [];
  }
  return await client
    .select({
      copiedCount: sourceDestinationMappingsTable.copiedCount,
      destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      lastErrorAt: sourceDestinationMappingsTable.lastErrorAt,
      lastSyncedAt: sourceDestinationMappingsTable.lastSyncedAt,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      skippedCount: sourceDestinationMappingsTable.skippedCount,
      syncId: sourceDestinationMappingsTable.syncId,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(calendarsTable, eq(sourceDestinationMappingsTable.destinationCalendarId, calendarsTable.id))
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(inArray(sourceDestinationMappingsTable.syncId, syncIds));
};

interface SourceHealthRow {
  calendarId: string;
  disabled: boolean;
  ingestFailureCount: number;
  needsReauthentication: boolean;
}

const readSourceHealth = async (client: ReadClient, calendarIds: string[]): Promise<Map<string, SourceHealthRow>> => {
  if (calendarIds.length === 0) {
    return new Map();
  }
  const rows = await client
    .select({
      calendarId: calendarsTable.id,
      disabled: calendarsTable.disabled,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(inArray(calendarsTable.id, calendarIds));
  return new Map(rows.map((row) => [row.calendarId, row]));
};

const resolveCalendarProblem = (health: { disabled: boolean; failing: boolean; needsReauthentication: boolean }): SyncCalendarProblem | null => {
  if (health.needsReauthentication) {
    return "reauth";
  }
  if (health.disabled) {
    return "disabled";
  }
  if (health.failing) {
    return "failing";
  }
  return null;
};

// A paused calendar is a choice, not a fault, so it's reported without marking the sync.
const isFault = (status: { problem: SyncCalendarProblem | null }): boolean =>
  status.problem !== null && status.problem !== "disabled";

const latest = (left: Date | null, right: Date | null): Date | null => {
  if (!left) {
    return right;
  }
  if (!right || left > right) {
    return left;
  }
  return right;
};

interface DestinationTally {
  calendarId: string;
  copiedCount: number;
  erroring: boolean;
  row: PairStatusRow;
  skippedCount: number;
  syncedAt: Date | null;
}

const summarizeDestinations = (rows: readonly PairStatusRow[]): SyncDestinationStatus[] => {
  const byDestination = new Map<string, DestinationTally>();
  for (const row of rows) {
    const tally = byDestination.get(row.destinationCalendarId) ?? {
      calendarId: row.destinationCalendarId,
      copiedCount: 0,
      erroring: false,
      row,
      skippedCount: 0,
      syncedAt: null,
    };
    tally.copiedCount += row.copiedCount;
    tally.skippedCount += row.skippedCount;
    tally.erroring ||= row.lastErrorAt !== null;
    tally.syncedAt = latest(tally.syncedAt, row.lastSyncedAt);
    byDestination.set(row.destinationCalendarId, tally);
  }
  return [...byDestination.values()].map((tally) => ({
    calendarId: tally.calendarId,
    copiedCount: tally.copiedCount,
    lastSyncedAt: tally.syncedAt?.toISOString() ?? null,
    problem: resolveCalendarProblem({
      disabled: tally.row.disabled,
      failing: tally.row.failureCount > 0 || tally.erroring,
      needsReauthentication: tally.row.needsReauthentication,
    }),
    skippedCount: tally.skippedCount,
  }));
};

const sourceCalendarIdsOf = (calendars: SyncCalendars): string[] => {
  if (calendars.mode === "both_ways") {
    return calendars.memberCalendarIds;
  }
  return calendars.sourceCalendarIds;
};

const summarizeSources = (definition: SyncDefinition, health: ReadonlyMap<string, SourceHealthRow>): SyncSourceStatus[] =>
  sourceCalendarIdsOf(definition).map((calendarId) => {
    const row = health.get(calendarId);
    if (!row) {
      return { calendarId, problem: null };
    }
    return {
      calendarId,
      problem: resolveCalendarProblem({
        disabled: row.disabled,
        failing: row.ingestFailureCount > 0,
        needsReauthentication: row.needsReauthentication,
      }),
    };
  });

const sumOf = <TItem>(items: readonly TItem[], value: (item: TItem) => number): number => {
  let total = 0;
  for (const item of items) {
    total += value(item);
  }
  return total;
};

const buildSyncDetail = (
  row: SyncRow,
  definition: SyncDefinition,
  pairRows: readonly PairStatusRow[],
  health: ReadonlyMap<string, SourceHealthRow>,
): SyncDetail => {
  const destinations = summarizeDestinations(pairRows);
  const sources = summarizeSources(definition, health);
  let lastSyncedAt: Date | null = null;
  for (const pair of pairRows) {
    lastSyncedAt = latest(lastSyncedAt, pair.lastSyncedAt);
  }
  return {
    ...definition,
    copiedCount: sumOf(destinations, (destination) => destination.copiedCount),
    createdAt: row.createdAt.toISOString(),
    destinations,
    id: row.id,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    pairCount: pairRows.length,
    skippedCount: sumOf(destinations, (destination) => destination.skippedCount),
    sources,
    state: resolveSyncState({
      hasProblem: destinations.some((destination) => isFault(destination)) || sources.some((source) => isFault(source)),
      pairCount: pairRows.length,
      paused: definition.paused,
    }),
    updatedAt: row.updatedAt.toISOString(),
  };
};

const readSyncDetails = async (client: ReadClient, rows: SyncRow[]): Promise<SyncDetail[]> => {
  const syncIds = rows.map((row) => row.id);
  const [calendarsBySyncId, pairRows] = await Promise.all([
    readSyncCalendars(client, syncIds),
    readPairStatuses(client, syncIds),
  ]);
  const entries = rows.map((row) => ({ definition: toDefinition(row, calendarsBySyncId.get(row.id)), row }));
  const sourceIds = new Set(entries.flatMap(({ definition }) => sourceCalendarIdsOf(definition)));
  const health = await readSourceHealth(client, [...sourceIds]);
  return entries.map(({ definition, row }) => buildSyncDetail(
    row,
    definition,
    pairRows.filter((pair) => pair.syncId === row.id),
    health,
  ));
};

const listSyncs = async (client: ReadClient, userId: string): Promise<SyncSummary[]> => {
  const rows = await client
    .select()
    .from(syncsTable)
    .where(eq(syncsTable.userId, userId))
    .orderBy(asc(syncsTable.createdAt), asc(syncsTable.id));
  const details = await readSyncDetails(client, rows);
  return details.map(({ destinations: _destinations, sources: _sources, ...summary }) => summary);
};

const findSyncDetail = async (client: ReadClient, userId: string, syncId: string): Promise<SyncDetail | null> => {
  if (!isUuid(syncId)) {
    return null;
  }
  const rows = await client
    .select()
    .from(syncsTable)
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
    .limit(1);
  const [detail] = await readSyncDetails(client, rows);
  return detail ?? null;
};

// Postgres keeps microseconds and one save writes several rows sharing one, so the cursor keeps Postgres's own text.
// A JS Date would round it to milliseconds, and the next page would skip the rest of that group.
interface ActivityCursor {
  createdAt: string;
  id: string;
}

const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const SECONDS_PRECISION_LENGTH = 19;

const isRealTimestamp = (value: string): boolean => {
  if (!CURSOR_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, SECONDS_PRECISION_LENGTH) === value.slice(0, SECONDS_PRECISION_LENGTH);
};

const encodeActivityCursor = (cursor: ActivityCursor): string => `${cursor.createdAt}_${cursor.id}`;

const decodeActivityCursor = (value: string | null): ActivityCursor | null => {
  if (!value) {
    return null;
  }
  const separator = value.indexOf("_");
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (separator === -1 || !isRealTimestamp(createdAt) || !isUuid(id)) {
    return null;
  }
  return { createdAt, id };
};

const clampPageSize = (value: number | null): number => {
  if (!value || !Number.isFinite(value) || value < 1) {
    return DEFAULT_ACTIVITY_PAGE_SIZE;
  }
  return Math.min(Math.floor(value), MAX_ACTIVITY_PAGE_SIZE);
};

const toActivityEntry = (row: typeof syncActivityTable.$inferSelect): SyncActivityEntry => {
  const createdAt = row.createdAt.toISOString();
  if (row.kind === "run") {
    return { createdAt, id: row.id, kind: "run", run: row.payload as unknown as SyncRunRecord };
  }
  return { change: row.payload as unknown as SyncChange, createdAt, id: row.id, kind: "change" };
};

interface PairSkips {
  skippedBy: SyncRunRecord["skippedBy"];
  skippedCount: number;
}

const summarizePairSkips = (pairs: readonly PairSkips[]): Pick<SyncActivitySummary, "skipped" | "skippedBy"> => {
  const reasons = new Map<string, SyncRunRecord["skippedBy"][number]>();
  for (const pair of pairs) {
    for (const reason of pair.skippedBy) {
      const current = reasons.get(reason.ruleId) ?? { count: 0, name: reason.name, ruleId: reason.ruleId };
      current.count += reason.count;
      reasons.set(reason.ruleId, current);
    }
  }
  return {
    skipped: sumOf(pairs, (pair) => pair.skippedCount),
    skippedBy: [...reasons.values()].toSorted((first, second) => second.count - first.count),
  };
};

// The window is today plus the six UTC days before it, matching how the engine buckets sync_activity_days.
const summarizeSyncActivity = async (client: ReadClient, syncId: string): Promise<SyncActivitySummary> => {
  const [[totals], pairs] = await Promise.all([
    client
      .select({
        added: sql<string>`coalesce(sum(${syncActivityDaysTable.added}), 0)`,
        removed: sql<string>`coalesce(sum(${syncActivityDaysTable.removed}), 0)`,
      })
      .from(syncActivityDaysTable)
      .where(and(
        eq(syncActivityDaysTable.syncId, syncId),
        sql`${syncActivityDaysTable.day} >= (now() at time zone 'utc')::date - ${sql.raw(String(ACTIVITY_SUMMARY_DAYS - 1))}`,
      )),
    client
      .select({ skippedBy: sourceDestinationMappingsTable.skippedBy, skippedCount: sourceDestinationMappingsTable.skippedCount })
      .from(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.syncId, syncId)),
  ]);
  return {
    added: Number(totals?.added ?? 0),
    removed: Number(totals?.removed ?? 0),
    ...summarizePairSkips(pairs),
  };
};

// Only the first page carries the summary, so paging back doesn't recount the window.
const readFirstPageSummary = (client: ReadClient, syncId: string, cursor: ActivityCursor | null): Promise<SyncActivitySummary | null> => {
  if (cursor) {
    return Promise.resolve(null);
  }
  return summarizeSyncActivity(client, syncId);
};

const listSyncActivity = async (
  client: ReadClient,
  syncId: string,
  options: { before: string | null; limit: number | null },
): Promise<SyncActivityPage> => {
  const limit = clampPageSize(options.limit);
  const cursor = decodeActivityCursor(options.before);
  const conditions = [eq(syncActivityTable.syncId, syncId)];
  if (cursor) {
    const cursorAt = sql`${cursor.createdAt}::timestamptz`;
    const olderThanCursor = or(
      lt(syncActivityTable.createdAt, cursorAt),
      and(eq(syncActivityTable.createdAt, cursorAt), lt(syncActivityTable.id, cursor.id)),
    );
    if (olderThanCursor) {
      conditions.push(olderThanCursor);
    }
  }
  const [rows, summary] = await Promise.all([
    client
      .select({
        ...getTableColumns(syncActivityTable),
        cursorAt: sql<string>`to_char(${syncActivityTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(syncActivityTable)
      .where(and(...conditions))
      .orderBy(desc(syncActivityTable.createdAt), desc(syncActivityTable.id))
      .limit(limit + 1),
    readFirstPageSummary(client, syncId, cursor),
  ]);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (rows.length > limit && last) {
    nextCursor = encodeActivityCursor({ createdAt: last.cursorAt, id: last.id });
  }
  return { entries: page.map((row) => toActivityEntry(row)), nextCursor, summary };
};

export {
  SYNC_CALENDARS_NOT_FOUND_ERROR_MESSAGE,
  SYNC_CONTENT_ERROR_MESSAGE,
  SYNC_LIMIT_ERROR_MESSAGE,
  SYNC_NOT_FOUND_ERROR_MESSAGE,
  SYNC_STALE_ERROR_MESSAGE,
  SyncConflictError,
  SyncContentNotAllowedError,
  SyncLimitError,
  SyncNotFoundError,
  SyncStaleError,
  SyncValidationError,
  assertSyncContentAllowed,
  buildSyncDetail,
  clampPageSize,
  createSync,
  createSyncWriteTransaction,
  decodeActivityCursor,
  deleteSync,
  deleteSyncRow,
  findSyncDestinationIds,
  findOwnedRequestedDestinationIds,
  findSyncDetail,
  findSyncForUser,
  isUuid,
  listSyncActivity,
  listSyncs,
  mergeSyncDefinition,
  runCreateSync,
  runLockedCreateSync,
  runLockedDeleteSync,
  runLockedUpdateSync,
  runUpdateSync,
  summarizePairSkips,
  updateSync,
};
export type { PairStatusRow, SourceHealthRow, StoredSync, SyncActivityPage, SyncLockDependencies, SyncWriteDependencies, SyncWriteTransaction };

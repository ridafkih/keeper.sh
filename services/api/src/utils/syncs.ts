import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
  syncActivityTable,
  syncCalendarsTable,
  syncStatusTable,
  syncsTable,
} from "@keeper.sh/database/schema";
import {
  DEFAULT_SYNC_SETTINGS,
  deriveSyncPairs,
  diffSyncChanges,
  normalizeSkipKeywords,
  normalizeSyncCalendars,
  resolveSyncState,
  syncCalendarIds,
  toShareAs,
  toSyncMode,
  validateSyncCalendars,
} from "@keeper.sh/data-schemas";
import type {
  AdvancedRule,
  AdvancedRuleInput,
  CreateSyncBody,
  PatchSyncBody,
  SyncActivityEntry,
  SyncCalendarRole,
  SyncCalendars,
  SyncChange,
  SyncConflict,
  SyncDefinition,
  SyncDestinationProblem,
  SyncDestinationStatus,
  SyncDetail,
  SyncPair,
  SyncRunRecord,
  SyncSummary,
} from "@keeper.sh/data-schemas";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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
const SYNC_CONFLICT_ERROR_MESSAGE = "Some calendars already copy into each other through another sync.";
const DEFAULT_ACTIVITY_PAGE_SIZE = 50;
const MAX_ACTIVITY_PAGE_SIZE = 100;

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];
type ReadClient = Pick<DatabaseClient, "select">;

class SyncLimitError extends Error {}
class SyncContentNotAllowedError extends Error {}
class SyncNotFoundError extends Error {}
class SyncValidationError extends Error {}
class SyncConflictError extends Error {
  readonly conflicts: SyncConflict[];

  constructor(conflicts: SyncConflict[]) {
    super(SYNC_CONFLICT_ERROR_MESSAGE);
    this.conflicts = conflicts;
  }
}

interface OwnedCalendar {
  capabilities: string[];
  id: string;
}

type SyncBody = CreateSyncBody | PatchSyncBody;

const withRuleIds = (rules: readonly AdvancedRuleInput[]): AdvancedRule[] =>
  rules.map((rule) => ({ ...rule, id: rule.id ?? crypto.randomUUID(), name: rule.name.trim() }));

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
  return withRuleIds(body.rules);
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

const proContent = (definition: SyncDefinition): string => JSON.stringify([
  definition.shareAs,
  definition.busyTitle,
  definition.markPrivate,
  definition.skipAllDay,
  definition.skipFocusTime,
  definition.skipOutOfOffice,
  definition.skipTitleKeywords,
  definition.rules,
]);

const FREE_CONTENT = proContent(EMPTY_SYNC_DEFINITION);

// Free plans share busy-only with nothing skipped; anything else needs Pro, and settings a sync already has are kept.
const assertSyncContentAllowed = async (
  canUseEventFilters: () => Promise<boolean>,
  current: SyncDefinition | null,
  next: SyncDefinition,
): Promise<void> => {
  const content = proContent(next);
  if (content === FREE_CONTENT || (current && proContent(current) === content)) {
    return;
  }
  if (!(await canUseEventFilters())) {
    throw new SyncContentNotAllowedError(SYNC_CONTENT_ERROR_MESSAGE);
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
  findPairConflicts: (syncId: string | null, pairs: SyncPair[]) => Promise<SyncConflict[]>;
  findSync: (userId: string, syncId: string) => Promise<SyncDefinition | null>;
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
  const conflicts = await transaction.findPairConflicts(syncId, pairs);
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
  const next = mergeSyncDefinition(current, body);
  assertValidDefinition(next);
  await assertSyncContentAllowed(() => dependencies.canUseEventFilters(userId), current, next);

  const changes = diffSyncChanges(current, next);
  if (changes.length === 0) {
    return changes;
  }
  if (isSyncWideChange(changes)) {
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
  skipFocusTime: row.skipFocusTime,
  skipOutOfOffice: row.skipOutOfOffice,
  skipTitleKeywords: row.skipTitleKeywords,
  sourceCalendarIds: calendars?.sourceCalendarIds ?? [],
});

const findSyncForUser = async (client: ReadClient, userId: string, syncId: string): Promise<SyncDefinition | null> => {
  const [row] = await client
    .select()
    .from(syncsTable)
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
    .limit(1);
  if (!row) {
    return null;
  }
  const calendars = await readSyncCalendars(client, [row.id]);
  return toDefinition(row, calendars.get(row.id));
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
  findPairConflicts: async (syncId, pairs) => {
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

const isRenameOnly = (body: PatchSyncBody): boolean =>
  Object.keys(body).every((key) => key === "name");

// Destinations are locked before the write, from both the old and the new pairs, so no push races the change.
const createSync = async (userId: string, body: CreateSyncBody): Promise<string> => {
  const { database } = await import("@/context");
  const dependencies = await createSyncWriteDependencies();
  const { result } = await withMappingMutationLocks(
    userId,
    () => findOwnedRequestedDestinationIds(database, userId, body),
    () => runCreateSync(userId, body, dependencies),
  );
  scheduleMappingReplacementSync(userId);
  return result;
};

const updateSync = async (userId: string, syncId: string, body: PatchSyncBody): Promise<void> => {
  const dependencies = await createSyncWriteDependencies();
  if (isRenameOnly(body)) {
    await runUpdateSync(userId, syncId, body, dependencies);
    return;
  }
  const { database } = await import("@/context");
  const { result } = await withMappingMutationLocks(
    userId,
    async () => [
      ...await findSyncDestinationIds(database, userId, syncId),
      ...await findOwnedRequestedDestinationIds(database, userId, body),
    ],
    () => runUpdateSync(userId, syncId, body, dependencies),
  );
  if (isSyncWideChange(result)) {
    scheduleMappingReplacementSync(userId);
  }
};

const deleteSync = async (userId: string, syncId: string): Promise<void> => {
  const { database } = await import("@/context");
  await withMappingMutationLocks(
    userId,
    () => findSyncDestinationIds(database, userId, syncId),
    () => database.transaction(async (client) => {
      await acquireUserSyncLock(client, userId);
      const [deleted] = await client
        .delete(syncsTable)
        .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
        .returning({ id: syncsTable.id });
      if (!deleted) {
        throw new SyncNotFoundError(SYNC_NOT_FOUND_ERROR_MESSAGE);
      }
      await requestUserSync(client, userId);
    }),
  );
  scheduleMappingReplacementSync(userId);
};

interface PairStatusRow {
  copiedCount: number;
  destinationCalendarId: string;
  disabled: boolean;
  failureCount: number;
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

const resolveDestinationProblem = (row: PairStatusRow): SyncDestinationProblem | null => {
  if (row.needsReauthentication) {
    return "reauth";
  }
  if (row.disabled) {
    return "disabled";
  }
  if (row.failureCount > 0) {
    return "failing";
  }
  return null;
};

const latest = (left: Date | null, right: Date | null): Date | null => {
  if (!left) {
    return right;
  }
  if (!right || left > right) {
    return left;
  }
  return right;
};

const summarizeDestinations = (rows: readonly PairStatusRow[]): SyncDestinationStatus[] => {
  const byDestination = new Map<string, SyncDestinationStatus & { syncedAt: Date | null }>();
  for (const row of rows) {
    const status = byDestination.get(row.destinationCalendarId) ?? {
      calendarId: row.destinationCalendarId,
      copiedCount: 0,
      lastSyncedAt: null,
      problem: resolveDestinationProblem(row),
      skippedCount: 0,
      syncedAt: null,
    };
    status.copiedCount += row.copiedCount;
    status.skippedCount += row.skippedCount;
    status.syncedAt = latest(status.syncedAt, row.lastSyncedAt);
    byDestination.set(row.destinationCalendarId, status);
  }
  return [...byDestination.values()].map(({ syncedAt, ...status }) => ({
    ...status,
    lastSyncedAt: syncedAt?.toISOString() ?? null,
  }));
};

const sumOf = <TItem>(items: readonly TItem[], value: (item: TItem) => number): number => {
  let total = 0;
  for (const item of items) {
    total += value(item);
  }
  return total;
};

const toSummary = (row: SyncRow, definition: SyncDefinition, pairRows: readonly PairStatusRow[]): SyncDetail => {
  const destinations = summarizeDestinations(pairRows);
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
    state: resolveSyncState({
      hasProblem: destinations.some((destination) => destination.problem !== null),
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
  return rows.map((row) => toSummary(
    row,
    toDefinition(row, calendarsBySyncId.get(row.id)),
    pairRows.filter((pair) => pair.syncId === row.id),
  ));
};

const listSyncs = async (client: ReadClient, userId: string): Promise<SyncSummary[]> => {
  const rows = await client
    .select()
    .from(syncsTable)
    .where(eq(syncsTable.userId, userId))
    .orderBy(asc(syncsTable.createdAt), asc(syncsTable.id));
  const details = await readSyncDetails(client, rows);
  return details.map(({ destinations: _destinations, ...summary }) => summary);
};

const findSyncDetail = async (client: ReadClient, userId: string, syncId: string): Promise<SyncDetail | null> => {
  const rows = await client
    .select()
    .from(syncsTable)
    .where(and(eq(syncsTable.id, syncId), eq(syncsTable.userId, userId)))
    .limit(1);
  const [detail] = await readSyncDetails(client, rows);
  return detail ?? null;
};

interface ActivityCursor {
  createdAt: Date;
  id: string;
}

const encodeActivityCursor = (cursor: ActivityCursor): string => `${cursor.createdAt.toISOString()}_${cursor.id}`;

const decodeActivityCursor = (value: string | null): ActivityCursor | null => {
  if (!value) {
    return null;
  }
  const separator = value.indexOf("_");
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (separator === -1 || Number.isNaN(createdAt.getTime()) || !id) {
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

interface SyncActivityPage {
  entries: SyncActivityEntry[];
  nextCursor: string | null;
}

const listSyncActivity = async (
  client: ReadClient,
  syncId: string,
  options: { before: string | null; limit: number | null },
): Promise<SyncActivityPage> => {
  const limit = clampPageSize(options.limit);
  const cursor = decodeActivityCursor(options.before);
  const conditions = [eq(syncActivityTable.syncId, syncId)];
  if (cursor) {
    const olderThanCursor = or(
      lt(syncActivityTable.createdAt, cursor.createdAt),
      and(eq(syncActivityTable.createdAt, cursor.createdAt), lt(syncActivityTable.id, cursor.id)),
    );
    if (olderThanCursor) {
      conditions.push(olderThanCursor);
    }
  }
  const rows = await client
    .select()
    .from(syncActivityTable)
    .where(and(...conditions))
    .orderBy(desc(syncActivityTable.createdAt), desc(syncActivityTable.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (rows.length > limit && last) {
    nextCursor = encodeActivityCursor(last);
  }
  return { entries: page.map((row) => toActivityEntry(row)), nextCursor };
};

export {
  SYNC_CONTENT_ERROR_MESSAGE,
  SYNC_LIMIT_ERROR_MESSAGE,
  SYNC_NOT_FOUND_ERROR_MESSAGE,
  SyncConflictError,
  SyncContentNotAllowedError,
  SyncLimitError,
  SyncNotFoundError,
  SyncValidationError,
  assertSyncContentAllowed,
  createSync,
  decodeActivityCursor,
  deleteSync,
  findSyncDetail,
  findSyncForUser,
  listSyncActivity,
  listSyncs,
  mergeSyncDefinition,
  runCreateSync,
  runUpdateSync,
  updateSync,
};
export type { SyncActivityPage, SyncWriteDependencies, SyncWriteTransaction };

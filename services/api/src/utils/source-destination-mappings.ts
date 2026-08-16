import {
  calendarAccountsTable,
  calendarsTable,
  eventMappingsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { WRITE_BACK_WITNESS_RESET } from "@keeper.sh/calendar";
import { createMappingMutationLockId, createSyncLock } from "@keeper.sh/sync";
import type { SyncLockHandle } from "@keeper.sh/sync";
import type { database as databaseInstance } from "@/context";
import { enqueuePushSync } from "./enqueue-push-sync";
import { spawnBackgroundJob } from "./background-task";
import { assertAllIdsOwned } from "./owned-ids";
import {
  describeNotApplicable,
  EMPTY_DESTINATION_DECISION,
  NO_DELETE_CONFIRMATION_PENDING_MESSAGE,
  resolveConfirmationDisposition,
} from "./delete-confirmation-policy";
import { resolveWritableWriteBackMode } from "@keeper.sh/data-schemas";
import { TWO_WAY_DELETE_APPROVAL_TTL_MS } from "@keeper.sh/constants";
const EMPTY_LIST_COUNT = 0;
const SINGLE_ROW = 1;
const NO_PENDING_DELETES = 0;
const USER_MAPPING_LOCK_NAMESPACE = 9001;
const MAPPING_LIMIT_ERROR_MESSAGE = "Mapping limit reached. Upgrade to Pro for unlimited sync mappings.";
const MAPPING_NOT_FOUND_ERROR_MESSAGE = "Mapping not found";
const WRITE_BACK_MODE_OFF = "off";

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];

interface SourceDestinationMapping {
  id: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
  createdAt: Date;
  calendarType: string;
}

interface SetDestinationsTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
  countUserMappings?: (userId: string) => Promise<number>;
  countMappingsForSource?: (sourceCalendarId: string) => Promise<number>;
  findOwnedDestinationIds: (
    userId: string,
    destinationCalendarIds: string[],
  ) => Promise<string[]>;
  findExistingDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
  deleteSourceMappings: (
    sourceCalendarId: string,
    destinationCalendarIds: string[],
  ) => Promise<void>;
  insertSourceMappings: (
    sourceCalendarId: string,
    destinationCalendarIds: string[],
  ) => Promise<void>;
  ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
  requestUserSync?: (userId: string) => Promise<void>;
}

type ResolveMappingLimit = (userId: string) => Promise<number>;

interface SetDestinationsDependencies {
  withTransaction: <TResult>(
    callback: (transaction: SetDestinationsTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
  resolveMappingLimit?: ResolveMappingLimit;
}

interface SetSourcesTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  destinationExists: (userId: string, destinationCalendarId: string) => Promise<boolean>;
  countUserMappings?: (userId: string) => Promise<number>;
  countMappingsForDestination?: (destinationCalendarId: string) => Promise<number>;
  findOwnedSourceIds: (userId: string, sourceCalendarIds: string[]) => Promise<string[]>;
  findExistingSourceIds: (destinationCalendarId: string) => Promise<string[]>;
  deleteDestinationMappings: (
    destinationCalendarId: string,
    sourceCalendarIds: string[],
  ) => Promise<void>;
  insertDestinationMappings: (
    destinationCalendarId: string,
    sourceCalendarIds: string[],
  ) => Promise<void>;
  ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
  requestUserSync?: (userId: string) => Promise<void>;
}

const requestUserSync = async (
  transactionClient: DatabaseTransactionClient,
  userId: string,
): Promise<void> => {
  const requestId = crypto.randomUUID();
  const requestedAt = new Date();
  await transactionClient
    .insert(userSyncRequestsTable)
    .values({ requestId, requestedAt, userId })
    .onConflictDoUpdate({
      target: userSyncRequestsTable.userId,
      set: { requestId, requestedAt },
    });
};

interface SetSourcesDependencies {
  withTransaction: <TResult>(
    callback: (transaction: SetSourcesTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
  resolveMappingLimit?: ResolveMappingLimit;
}

const diffCalendarIdSet = (
  existingIds: string[],
  desiredIds: string[],
): { added: string[]; removed: string[] } => {
  const existing = new Set(existingIds);
  const desired = new Set(desiredIds);
  return {
    added: desiredIds.filter((id) => !existing.has(id)),
    removed: existingIds.filter((id) => !desired.has(id)),
  };
};

const createSetDestinationsTransaction = (
  transactionClient: DatabaseTransactionClient,
): SetDestinationsTransaction => ({
  acquireUserLock: async (userId) => {
    await transactionClient.execute(
      sql`select pg_advisory_xact_lock(${USER_MAPPING_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );
  },
  sourceExists: async (userId, sourceCalendarId) => {
    const [source] = await transactionClient
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.id, sourceCalendarId),
          eq(calendarsTable.userId, userId),
        ),
      )
      .limit(1);

    return Boolean(source);
  },
  countUserMappings: async (userId) => {
    const [result] = await transactionClient
      .select({ value: sql<number>`count(*)` })
      .from(sourceDestinationMappingsTable)
      .innerJoin(
        calendarsTable,
        eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
      )
      .where(eq(calendarsTable.userId, userId));

    return Number(result?.value ?? EMPTY_LIST_COUNT);
  },
  countMappingsForSource: async (sourceCalendarId) => {
    const [result] = await transactionClient
      .select({ value: sql<number>`count(*)` })
      .from(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

    return Number(result?.value ?? EMPTY_LIST_COUNT);
  },
  findOwnedDestinationIds: async (userId, destinationCalendarIds) => {
    if (destinationCalendarIds.length === EMPTY_LIST_COUNT) {
      return [];
    }

    const ownedDestinations = await transactionClient
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, destinationCalendarIds),
        ),
      );

    return ownedDestinations.map(({ id }) => id);
  },
  findExistingDestinationIds: async (sourceCalendarId) => {
    const existing = await transactionClient
      .select({
        destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
      })
      .from(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

    return existing.map(({ destinationCalendarId }) => destinationCalendarId);
  },
  deleteSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
    if (destinationCalendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .delete(sourceDestinationMappingsTable)
      .where(and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        inArray(
          sourceDestinationMappingsTable.destinationCalendarId,
          destinationCalendarIds,
        ),
      ));
  },
  insertSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
    if (destinationCalendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .insert(sourceDestinationMappingsTable)
      .values(
        destinationCalendarIds.map((destinationCalendarId) => ({
          destinationCalendarId,
          sourceCalendarId,
        })),
      )
      .onConflictDoNothing();
  },
  ensureDestinationSyncStatuses: async (destinationCalendarIds) => {
    for (const destinationCalendarId of destinationCalendarIds) {
      await transactionClient
        .insert(syncStatusTable)
        .values({ calendarId: destinationCalendarId })
        .onConflictDoNothing();
    }
  },
  requestUserSync: (userId) => requestUserSync(transactionClient, userId),
});

const createSetSourcesTransaction = (
  transactionClient: DatabaseTransactionClient,
): SetSourcesTransaction => ({
  acquireUserLock: async (userId) => {
    await transactionClient.execute(
      sql`select pg_advisory_xact_lock(${USER_MAPPING_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );
  },
  destinationExists: async (userId, destinationCalendarId) => {
    const [destination] = await transactionClient
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.id, destinationCalendarId),
          eq(calendarsTable.userId, userId),
        ),
      )
      .limit(1);

    return Boolean(destination);
  },
  countUserMappings: async (userId) => {
    const [result] = await transactionClient
      .select({ value: sql<number>`count(*)` })
      .from(sourceDestinationMappingsTable)
      .innerJoin(
        calendarsTable,
        eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
      )
      .where(eq(calendarsTable.userId, userId));

    return Number(result?.value ?? EMPTY_LIST_COUNT);
  },
  countMappingsForDestination: async (destinationCalendarId) => {
    const [result] = await transactionClient
      .select({ value: sql<number>`count(*)` })
      .from(sourceDestinationMappingsTable)
      .where(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      );

    return Number(result?.value ?? EMPTY_LIST_COUNT);
  },
  findOwnedSourceIds: async (userId, sourceCalendarIds) => {
    if (sourceCalendarIds.length === EMPTY_LIST_COUNT) {
      return [];
    }

    const ownedSources = await transactionClient
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, sourceCalendarIds),
        ),
      );

    return ownedSources.map(({ id }) => id);
  },
  findExistingSourceIds: async (destinationCalendarId) => {
    const existing = await transactionClient
      .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
      .from(sourceDestinationMappingsTable)
      .where(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      );

    return existing.map(({ sourceCalendarId }) => sourceCalendarId);
  },
  deleteDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
    if (sourceCalendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .delete(sourceDestinationMappingsTable)
      .where(and(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        inArray(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarIds),
      ));
  },
  insertDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
    if (sourceCalendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .insert(sourceDestinationMappingsTable)
      .values(
        sourceCalendarIds.map((sourceCalendarId) => ({
          sourceCalendarId,
          destinationCalendarId,
        })),
      )
      .onConflictDoNothing();
  },
  ensureDestinationSyncStatuses: async (destinationCalendarIds) => {
    for (const destinationCalendarId of destinationCalendarIds) {
      await transactionClient
        .insert(syncStatusTable)
        .values({ calendarId: destinationCalendarId })
        .onConflictDoNothing();
    }
  },
  requestUserSync: (userId) => requestUserSync(transactionClient, userId),
});

const createSetDestinationsDependencies = async (): Promise<SetDestinationsDependencies> => {
  const { database, premiumService } = await import("@/context");

  return {
    resolveMappingLimit: async (userId) => {
      const userPlan = await premiumService.getUserPlan(userId);
      return premiumService.getMappingLimit(userPlan);
    },
    withTransaction: (callback) =>
      database.transaction((transactionClient) =>
        callback(createSetDestinationsTransaction(transactionClient))),
  };
};

const createSetSourcesDependencies = async (): Promise<SetSourcesDependencies> => {
  const { database, premiumService } = await import("@/context");

  return {
    resolveMappingLimit: async (userId) => {
      const userPlan = await premiumService.getUserPlan(userId);
      return premiumService.getMappingLimit(userPlan);
    },
    withTransaction: (callback) =>
      database.transaction((transactionClient) =>
        callback(createSetSourcesTransaction(transactionClient))),
  };
};

const resolveMappingLimitOrNull = (
  userId: string,
  resolve?: ResolveMappingLimit,
): Promise<number | null> => {
  if (!resolve) {
    return Promise.resolve(null);
  }
  return resolve(userId);
};

const runSetDestinationsForSource = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarIds: string[],
  dependencies: SetDestinationsDependencies,
): Promise<void> => {
  const uniqueDestinationCalendarIds = [...new Set(destinationCalendarIds)];

  const mappingLimit = await resolveMappingLimitOrNull(userId, dependencies.resolveMappingLimit);

  await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(userId);

    const sourceExists = await transaction.sourceExists(userId, sourceCalendarId);
    if (!sourceExists) {
      throw new Error("Source calendar not found");
    }

    if (uniqueDestinationCalendarIds.length > EMPTY_LIST_COUNT) {
      const validDestinationIds = await transaction.findOwnedDestinationIds(
        userId,
        uniqueDestinationCalendarIds,
      );
      assertAllIdsOwned(
        uniqueDestinationCalendarIds,
        validDestinationIds,
        "Some destination calendars not found",
      );
    }

    if (
      mappingLimit !== null
      && transaction.countUserMappings
      && transaction.countMappingsForSource
    ) {
      const [currentMappingCount, currentSourceMappingCount] = await Promise.all([
        transaction.countUserMappings(userId),
        transaction.countMappingsForSource(sourceCalendarId),
      ]);
      const nextMappingCount = currentMappingCount
        - currentSourceMappingCount
        + uniqueDestinationCalendarIds.length;

      if (nextMappingCount > mappingLimit) {
        throw new Error(MAPPING_LIMIT_ERROR_MESSAGE);
      }
    }

    const existingDestinationIds = await transaction.findExistingDestinationIds(sourceCalendarId);
    const { added, removed } = diffCalendarIdSet(
      existingDestinationIds,
      uniqueDestinationCalendarIds,
    );

    await transaction.deleteSourceMappings(sourceCalendarId, removed);
    await transaction.insertSourceMappings(sourceCalendarId, added);

    if (uniqueDestinationCalendarIds.length > EMPTY_LIST_COUNT) {
      await transaction.ensureDestinationSyncStatuses(uniqueDestinationCalendarIds);
    }
    await transaction.requestUserSync?.(userId);
  });
};

const runSetSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
  dependencies: SetSourcesDependencies,
): Promise<void> => {
  const uniqueSourceCalendarIds = [...new Set(sourceCalendarIds)];

  const mappingLimit = await resolveMappingLimitOrNull(userId, dependencies.resolveMappingLimit);

  await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(userId);

    const destinationExists = await transaction.destinationExists(
      userId,
      destinationCalendarId,
    );
    if (!destinationExists) {
      throw new Error("Destination calendar not found");
    }

    if (uniqueSourceCalendarIds.length > EMPTY_LIST_COUNT) {
      const validSourceIds = await transaction.findOwnedSourceIds(userId, uniqueSourceCalendarIds);
      assertAllIdsOwned(uniqueSourceCalendarIds, validSourceIds, "Some source calendars not found");
    }

    if (
      mappingLimit !== null
      && transaction.countUserMappings
      && transaction.countMappingsForDestination
    ) {
      const [currentMappingCount, currentDestinationMappingCount] = await Promise.all([
        transaction.countUserMappings(userId),
        transaction.countMappingsForDestination(destinationCalendarId),
      ]);
      const nextMappingCount = currentMappingCount
        - currentDestinationMappingCount
        + uniqueSourceCalendarIds.length;

      if (nextMappingCount > mappingLimit) {
        throw new Error(MAPPING_LIMIT_ERROR_MESSAGE);
      }
    }

    const existingSourceIds = await transaction.findExistingSourceIds(destinationCalendarId);
    const { added, removed } = diffCalendarIdSet(existingSourceIds, uniqueSourceCalendarIds);

    await transaction.deleteDestinationMappings(destinationCalendarId, removed);
    await transaction.insertDestinationMappings(destinationCalendarId, added);

    if (uniqueSourceCalendarIds.length > EMPTY_LIST_COUNT) {
      await transaction.ensureDestinationSyncStatuses([destinationCalendarId]);
    }
    await transaction.requestUserSync?.(userId);
  });
};

const getUserMappings = async (userId: string): Promise<SourceDestinationMapping[]> => {
  const { database } = await import("@/context");

  const userSourceCalendars = await database
    .select({
      calendarType: calendarsTable.calendarType,
      id: calendarsTable.id,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(
          calendarsTable.id,
          database
            .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  if (userSourceCalendars.length === EMPTY_LIST_COUNT) {
    return [];
  }

  const calendarIds = userSourceCalendars.map((calendar) => calendar.id);
  const typeByCalendarId = new Map(
    userSourceCalendars.map((calendar) => [calendar.id, calendar.calendarType]),
  );

  const mappings = await database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds));

  return mappings.map((mapping) => ({
    ...mapping,
    calendarType: typeByCalendarId.get(mapping.sourceCalendarId) ?? "unknown",
  }));
};

const getDestinationsForSource = async (userId: string, sourceCalendarId: string): Promise<string[]> => {
  const { database } = await import("@/context");

  const mappings = await database
    .select({ destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId })
    .from(sourceDestinationMappingsTable)
    .innerJoin(calendarsTable, eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id))
    .where(
      and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        eq(calendarsTable.userId, userId),
      ),
    );

  return mappings.map((mapping) => mapping.destinationCalendarId);
};

const getWriteBackModesForSource = async (
  userId: string,
  sourceCalendarId: string,
): Promise<Record<string, string>> => {
  const { database } = await import("@/context");

  const mappings = await database
    .select({
      calendarType: calendarsTable.calendarType,
      capabilities: calendarsTable.capabilities,
      destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
      disabled: calendarsTable.disabled,
      writeBackMode: sourceDestinationMappingsTable.writeBackMode,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .where(and(
      eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
      eq(calendarsTable.userId, userId),
    ));

  /*
   * A source that lost write access after two-way was switched on still carries the mode
   * it was given. Reporting it as it stands puts two contradictory answers on the same
   * screen — the two-way promise and "Keeper.sh can only read it" — so the screen is told
   * what the write-back pass will actually do, and the stored mode returns with the access.
   */
  return Object.fromEntries(
    mappings.map((mapping) =>
      [
        mapping.destinationCalendarId,
        resolveWritableWriteBackMode(mapping.writeBackMode, {
          calendarType: mapping.calendarType,
          capabilities: mapping.capabilities,
          disabled: mapping.disabled,
        }),
      ]),
  );
};

interface BlankReadGateObservations {
  copiesMissingObservedAt: Date | null;
  deleteConfirmationApprovedAt: Date | null;
  lastHealthyReadAt: Date | null;
}

/*
 * What "Delete the originals" is offered on after a read that returned nothing at all: a
 * read that came back with at least one copy AFTER the copies were first found missing.
 * That proves the credential still works and that the calendar id still points at the
 * calendar the copies were in — reconnecting on its own proves only the first.
 *
 * An approval still inside its half-hour lifetime carries the tail of the batch it was
 * given for through, matching what the sync pass exempts under the same window — and only
 * that batch. An answer given before these copies were found missing was an answer to a
 * different question: a breaker trip minutes earlier, or an earlier disappearance that was
 * settled. Carrying it forward would unlock every blank read for the next half hour,
 * including the one an outage caused, which is the single reading this gate exists to
 * refuse. So the approval must postdate the disappearance it is being read against.
 */
const resolveDeletesUnlocked = (
  observations: BlankReadGateObservations,
  now: Date,
): boolean => {
  const { copiesMissingObservedAt, deleteConfirmationApprovedAt, lastHealthyReadAt } =
    observations;
  if (!copiesMissingObservedAt) {
    return false;
  }
  if (lastHealthyReadAt && lastHealthyReadAt.getTime() > copiesMissingObservedAt.getTime()) {
    return true;
  }
  if (!deleteConfirmationApprovedAt) {
    return false;
  }
  return deleteConfirmationApprovedAt.getTime() > copiesMissingObservedAt.getTime()
    && now.getTime() - deleteConfirmationApprovedAt.getTime()
      < TWO_WAY_DELETE_APPROVAL_TTL_MS;
};

const getWriteBackStatesForSource = async (
  userId: string,
  sourceCalendarId: string,
): Promise<
  Record<string, { deletesUnlocked: boolean; reason: string | null; state: string }>
> => {
  const { database } = await import("@/context");

  const mappings = await database
    .select({
      copiesMissingObservedAt: sourceDestinationMappingsTable.copiesMissingObservedAt,
      deleteConfirmationApprovedAt:
        sourceDestinationMappingsTable.deleteConfirmationApprovedAt,
      destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId,
      lastHealthyReadAt: sourceDestinationMappingsTable.lastHealthyReadAt,
      writeBackState: sourceDestinationMappingsTable.writeBackState,
      writeBackStateReason: sourceDestinationMappingsTable.writeBackStateReason,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .where(and(
      eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
      eq(calendarsTable.userId, userId),
    ));

  const now = new Date();
  return Object.fromEntries(
    mappings.map((mapping) => [
      mapping.destinationCalendarId,
      {
        deletesUnlocked: resolveDeletesUnlocked(mapping, now),
        reason: mapping.writeBackStateReason,
        state: mapping.writeBackState,
      },
    ]),
  );
};

const getSourcesForDestination = async (userId: string, destinationCalendarId: string): Promise<string[]> => {
  const { database } = await import("@/context");

  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .innerJoin(calendarsTable, eq(sourceDestinationMappingsTable.destinationCalendarId, calendarsTable.id))
    .where(
      and(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        eq(calendarsTable.userId, userId),
      ),
    );

  return mappings.map((mapping) => mapping.sourceCalendarId);
};

const getOwnedCalendarIds = async (
  userId: string,
  calendarIds: string[],
): Promise<string[]> => {
  if (calendarIds.length === 0) {
    return [];
  }
  const { database } = await import("@/context");
  const calendars = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(and(
      eq(calendarsTable.userId, userId),
      inArray(calendarsTable.id, calendarIds),
    ));
  return calendars.map(({ id }) => id);
};

const releaseSyncHandles = async (handles: SyncLockHandle[]): Promise<void> => {
  const settlements = await Promise.allSettled(
    handles.toReversed().map((handle) => handle.release()),
  );
  const failures = settlements
    .filter((settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected")
    .map((settlement) => settlement.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to release mapping mutation locks");
  }
};

const releaseMappingMutationLocks = async (
  destinationHandles: SyncLockHandle[],
  mutationHandle: SyncLockHandle,
): Promise<unknown[]> => {
  const releaseFailures: unknown[] = [];
  try {
    await releaseSyncHandles(destinationHandles);
  } catch (error) {
    releaseFailures.push(error);
  }
  try {
    await mutationHandle.release();
  } catch (error) {
    releaseFailures.push(error);
  }
  return releaseFailures;
};

const settle = async <TResult>(
  callback: () => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>> => {
  try {
    return { status: "fulfilled", value: await callback() };
  } catch (error) {
    return { reason: error, status: "rejected" };
  }
};

interface MappingMutationSyncLock {
  acquire: ReturnType<typeof createSyncLock>["acquire"];
}

const runWithMappingMutationLocks = async <TResult>(
  syncLock: MappingMutationSyncLock,
  userId: string,
  resolveDestinationCalendarIds: () => Promise<string[]>,
  callback: () => Promise<TResult>,
): Promise<{ destinationCalendarIds: string[]; result: TResult }> => {
  const mutationLock = await syncLock.acquire(createMappingMutationLockId(userId));
  if (!mutationLock.acquired) {
    throw new Error("Mapping update was superseded by another request");
  }

  const destinationHandles: SyncLockHandle[] = [];
  const operation = await settle(async () => {
    const destinationCalendarIds = [...new Set(await resolveDestinationCalendarIds())].toSorted();
    for (const destinationCalendarId of destinationCalendarIds) {
      const destinationLock = await syncLock.acquire(destinationCalendarId);
      if (!destinationLock.acquired) {
        throw new Error(`Unable to coordinate mapping update for destination ${destinationCalendarId}`);
      }
      destinationHandles.push(destinationLock.handle);
    }

    const heldStates = await Promise.all([
      mutationLock.handle.isHeld(),
      ...destinationHandles.map((handle) => handle.isHeld()),
    ]);
    if (heldStates.some((held) => !held)) {
      throw new Error("Mapping update lost its reconciliation lock before mutation");
    }

    return {
      destinationCalendarIds,
      result: await callback(),
    };
  });
  const releaseFailures = await releaseMappingMutationLocks(
    destinationHandles,
    mutationLock.handle,
  );
  if (operation.status === "rejected") {
    if (releaseFailures.length > 0) {
      throw new AggregateError(
        [operation.reason, ...releaseFailures],
        "Mapping mutation failed and its locks could not be fully released",
        { cause: operation.reason },
      );
    }
    throw operation.reason;
  }
  if (releaseFailures.length > 0) {
    throw new AggregateError(releaseFailures, "Failed to release mapping mutation locks");
  }
  return operation.value;
};

const withMappingMutationLocks = async <TResult>(
  userId: string,
  resolveDestinationCalendarIds: () => Promise<string[]>,
  callback: () => Promise<TResult>,
): Promise<{ destinationCalendarIds: string[]; result: TResult }> => {
  const { redis } = await import("@/context");
  return runWithMappingMutationLocks(
    createSyncLock(redis),
    userId,
    resolveDestinationCalendarIds,
    callback,
  );
};

const enqueueMappingReplacementSync = async (userId: string): Promise<void> => {
  const { database, premiumService } = await import("@/context");
  const [request] = await database
    .select({ requestId: userSyncRequestsTable.requestId })
    .from(userSyncRequestsTable)
    .where(eq(userSyncRequestsTable.userId, userId))
    .limit(1);
  if (!request) {
    return;
  }
  const plan = await premiumService.getUserPlan(userId);
  if (!plan) {
    throw new Error("Unable to resolve user plan for mapping sync enqueue");
  }
  await enqueuePushSync(userId, plan);
  await database
    .delete(userSyncRequestsTable)
    .where(and(
      eq(userSyncRequestsTable.userId, userId),
      eq(userSyncRequestsTable.requestId, request.requestId),
    ));
};

const scheduleMappingReplacementSync = (userId: string): void => {
  spawnBackgroundJob(
    "mapping-replacement-push-enqueue",
    { userId },
    () => enqueueMappingReplacementSync(userId),
  );
};

const resolveWriteBackEnabledAt = (writeBackMode: string): Date | null => {
  if (writeBackMode === WRITE_BACK_MODE_OFF) {
    return null;
  }
  return new Date();
};

const sourceSupportsWriteBack = async (
  userId: string,
  sourceCalendarId: string,
): Promise<boolean> => {
  const { database } = await import("@/context");
  const [source] = await database
    .select({
      calendarType: calendarsTable.calendarType,
      capabilities: calendarsTable.capabilities,
      disabled: calendarsTable.disabled,
    })
    .from(calendarsTable)
    .where(and(
      eq(calendarsTable.id, sourceCalendarId),
      eq(calendarsTable.userId, userId),
    ))
    .limit(1);

  if (!source) {
    return false;
  }
  /*
   * The same rule the screen is answered with. A paused source is reported as one-way
   * there, so accepting two-way on it stores a mode the screen denies and that goes live
   * unannounced the moment the calendar is resumed.
   */
  return resolveWritableWriteBackMode("edits", {
    calendarType: source.calendarType,
    capabilities: source.capabilities,
    disabled: source.disabled,
  }) !== "off";
};

const clearDestinationWitness = async (
  transactionClient: DatabaseTransactionClient,
  sourceCalendarId: string,
  destinationCalendarId: string,
): Promise<void> => {
  await transactionClient
    .update(eventMappingsTable)
    .set({ ...WRITE_BACK_WITNESS_RESET })
    .where(and(
      eq(eventMappingsTable.calendarId, destinationCalendarId),
      eq(eventMappingsTable.sourceCalendarId, sourceCalendarId),
    ));
};

const setWriteBackMode = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
  writeBackMode: string,
): Promise<void> => {
  const { database } = await import("@/context");
  const ownedCalendarIds = await getOwnedCalendarIds(
    userId,
    [sourceCalendarId, destinationCalendarId],
  );
  assertAllIdsOwned(
    [sourceCalendarId, destinationCalendarId],
    ownedCalendarIds,
    MAPPING_NOT_FOUND_ERROR_MESSAGE,
  );

  await database.transaction(async (transactionClient) => {
    const updated = await transactionClient
      .update(sourceDestinationMappingsTable)
      .set({
        deleteConfirmationApprovedAt: null,
        writeBackEnabledAt: resolveWriteBackEnabledAt(writeBackMode),
        writeBackMode,
        writeBackState: "ok",
        writeBackStateReason: null,
      })
      .where(and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      ))
      .returning({ id: sourceDestinationMappingsTable.id });

    if (updated.length === EMPTY_LIST_COUNT) {
      throw new Error(MAPPING_NOT_FOUND_ERROR_MESSAGE);
    }

    /*
     * The recorded observation belongs to the policy it was taken under. Clearing it
     * with the transition means the first pass after a change adopts what the
     * destination reports instead of acting on a witness from a different regime.
     */
    await clearDestinationWitness(
      transactionClient,
      sourceCalendarId,
      destinationCalendarId,
    );
    await requestUserSync(transactionClient, userId);
  });
  scheduleMappingReplacementSync(userId);
};

/*
 * Declining puts the copies back: the pending counters are what a later pass would have
 * deleted the originals from, so clearing them both cancels the deletions and releases
 * the mirrors to be re-created. Approving leaves them exactly where they are — they name
 * the deletions the answer is about — and stamps the consent the breaker reads.
 */
const clearPendingDeleteState = async (
  transactionClient: DatabaseTransactionClient,
  sourceCalendarId: string,
  destinationCalendarId: string,
): Promise<void> => {
  await transactionClient
    .update(eventMappingsTable)
    .set({ missingFirstObservedAt: null, missingObservationCount: NO_PENDING_DELETES })
    .where(and(
      eq(eventMappingsTable.calendarId, destinationCalendarId),
      eq(eventMappingsTable.sourceCalendarId, sourceCalendarId),
    ));
};

const resolveDeleteApprovedAt = (approved: boolean): Date | null => {
  if (!approved) {
    return null;
  }
  return new Date();
};

/*
 * The only half of "the copies were deleted, or the connection is broken" that Keeper.sh
 * holds an answer to: a destination whose account is waiting to be signed in again, or a
 * calendar the user paused, is one it already knows it cannot read. The user's word that
 * the destination is empty is not accepted against a calendar in that state, and it is the
 * only answer that weighs this, so no other answer pays for the read.
 */
const resolveDestinationReachable = async (
  transactionClient: DatabaseTransactionClient,
  decision: string,
  destinationCalendarId: string,
): Promise<boolean> => {
  if (decision !== EMPTY_DESTINATION_DECISION) {
    return false;
  }
  const [destination] = await transactionClient
    .select({
      disabled: calendarsTable.disabled,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
    })
    .from(calendarsTable)
    .innerJoin(
      calendarAccountsTable,
      eq(calendarsTable.accountId, calendarAccountsTable.id),
    )
    .where(eq(calendarsTable.id, destinationCalendarId))
    .limit(SINGLE_ROW);

  if (!destination) {
    return false;
  }
  return !destination.disabled && !destination.needsReauthentication;
};

const resolveDeleteConfirmation = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
  decision: string,
): Promise<void> => {
  const { database } = await import("@/context");
  const ownedCalendarIds = await getOwnedCalendarIds(
    userId,
    [sourceCalendarId, destinationCalendarId],
  );
  assertAllIdsOwned(
    [sourceCalendarId, destinationCalendarId],
    ownedCalendarIds,
    MAPPING_NOT_FOUND_ERROR_MESSAGE,
  );

  let approved = false;

  await database.transaction(async (transactionClient) => {
    const [observed] = await transactionClient
      .select({
        copiesMissingObservedAt: sourceDestinationMappingsTable.copiesMissingObservedAt,
        deleteConfirmationApprovedAt:
          sourceDestinationMappingsTable.deleteConfirmationApprovedAt,
        lastHealthyReadAt: sourceDestinationMappingsTable.lastHealthyReadAt,
        writeBackState: sourceDestinationMappingsTable.writeBackState,
        writeBackStateReason: sourceDestinationMappingsTable.writeBackStateReason,
      })
      .from(sourceDestinationMappingsTable)
      .where(and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      ))
      .limit(SINGLE_ROW);

    if (!observed) {
      throw new Error(MAPPING_NOT_FOUND_ERROR_MESSAGE);
    }

    const pending = {
      ...observed,
      decision,
      deletesUnlocked: resolveDeletesUnlocked(observed, new Date()),
      destinationReachable: await resolveDestinationReachable(
        transactionClient,
        decision,
        destinationCalendarId,
      ),
    };
    const disposition = resolveConfirmationDisposition(decision, pending);
    if (disposition === "not_pending") {
      throw new Error(NO_DELETE_CONFIRMATION_PENDING_MESSAGE);
    }
    if (disposition === "not_applicable") {
      throw new Error(describeNotApplicable(pending));
    }
    if (disposition === "ignore") {
      return;
    }
    approved = disposition === "approve";

    const updated = await transactionClient
      .update(sourceDestinationMappingsTable)
      .set({
        deleteConfirmationApprovedAt: resolveDeleteApprovedAt(approved),
        writeBackState: "ok",
        writeBackStateReason: null,
      })
      .where(and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      ))
      .returning({ id: sourceDestinationMappingsTable.id });

    if (updated.length === EMPTY_LIST_COUNT) {
      throw new Error(MAPPING_NOT_FOUND_ERROR_MESSAGE);
    }

    if (!approved) {
      await clearPendingDeleteState(
        transactionClient,
        sourceCalendarId,
        destinationCalendarId,
      );
      await clearDestinationWitness(
        transactionClient,
        sourceCalendarId,
        destinationCalendarId,
      );
    }
    await requestUserSync(transactionClient, userId);
  });
  scheduleMappingReplacementSync(userId);
};

const setDestinationsForSource = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarIds: string[],
): Promise<void> => {
  const dependencies = await createSetDestinationsDependencies();
  await withMappingMutationLocks(
    userId,
    async () => {
      const ownedDestinationCalendarIds = await getOwnedCalendarIds(
        userId,
        destinationCalendarIds,
      );
      assertAllIdsOwned(
        destinationCalendarIds,
        ownedDestinationCalendarIds,
        "Some destination calendars not found",
      );
      return [
        ...await getDestinationsForSource(userId, sourceCalendarId),
        ...ownedDestinationCalendarIds,
      ];
    },
    () => runSetDestinationsForSource(
      userId,
      sourceCalendarId,
      destinationCalendarIds,
      dependencies,
    ),
  );
  scheduleMappingReplacementSync(userId);
};

const setSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<void> => {
  const dependencies = await createSetSourcesDependencies();
  await withMappingMutationLocks(
    userId,
    async () => {
      const ownedDestinationCalendarIds = await getOwnedCalendarIds(
        userId,
        [destinationCalendarId],
      );
      assertAllIdsOwned(
        [destinationCalendarId],
        ownedDestinationCalendarIds,
        "Destination calendar not found",
      );
      return ownedDestinationCalendarIds;
    },
    () => runSetSourcesForDestination(
      userId,
      destinationCalendarId,
      sourceCalendarIds,
      dependencies,
    ),
  );
  scheduleMappingReplacementSync(userId);
};

export {
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  getWriteBackModesForSource,
  getWriteBackStatesForSource,
  MAPPING_LIMIT_ERROR_MESSAGE,
  MAPPING_NOT_FOUND_ERROR_MESSAGE,
  resolveDeleteConfirmation,
  setDestinationsForSource,
  setWriteBackMode,
  sourceSupportsWriteBack,
  setSourcesForDestination,
  runSetDestinationsForSource,
  runSetSourcesForDestination,
  runWithMappingMutationLocks,
  withMappingMutationLocks,
  enqueueMappingReplacementSync,
  requestUserSync,
  scheduleMappingReplacementSync,
};
export type { MappingMutationSyncLock };

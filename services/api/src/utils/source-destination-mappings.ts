import {
  calendarsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createMappingMutationLockId, createSyncLock } from "@keeper.sh/sync";
import type { SyncLockHandle } from "@keeper.sh/sync";
import type { database as databaseInstance } from "@/context";
import { enqueuePushSync } from "./enqueue-push-sync";
import { spawnBackgroundJob } from "./background-task";
const EMPTY_LIST_COUNT = 0;
const USER_MAPPING_LOCK_NAMESPACE = 9001;
const MAPPING_LIMIT_ERROR_MESSAGE = "Mapping limit reached. Upgrade to Pro for unlimited sync mappings.";

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
  replaceSourceMappings: (
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
  replaceDestinationMappings: (
    destinationCalendarId: string,
    sourceCalendarIds: string[],
  ) => Promise<void>;
  ensureDestinationSyncStatus: (destinationCalendarId: string) => Promise<void>;
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

const assertAllIdsOwned = (
  requestedIds: string[],
  validIds: string[],
  errorMessage: string,
): void => {
  const validIdSet = new Set(validIds);
  const invalidIds = requestedIds.filter((requestedId) => !validIdSet.has(requestedId));
  if (invalidIds.length > EMPTY_LIST_COUNT) {
    throw new Error(errorMessage);
  }
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
  replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
    await transactionClient
      .delete(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

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
  replaceDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
    await transactionClient
      .delete(sourceDestinationMappingsTable)
      .where(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
      );

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
  ensureDestinationSyncStatus: async (destinationCalendarId) => {
    await transactionClient
      .insert(syncStatusTable)
      .values({ calendarId: destinationCalendarId })
      .onConflictDoNothing();
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

    await transaction.replaceSourceMappings(sourceCalendarId, uniqueDestinationCalendarIds);

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

    await transaction.replaceDestinationMappings(destinationCalendarId, uniqueSourceCalendarIds);

    if (uniqueSourceCalendarIds.length > EMPTY_LIST_COUNT) {
      await transaction.ensureDestinationSyncStatus(destinationCalendarId);
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
  MAPPING_LIMIT_ERROR_MESSAGE,
  setDestinationsForSource,
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

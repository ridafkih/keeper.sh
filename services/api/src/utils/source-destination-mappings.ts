import {
  calendarsTable,
  sourceDestinationMappingsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createMappingMutationLockId, createSyncLock } from "@keeper.sh/sync";
import type { SyncLockHandle } from "@keeper.sh/sync";
import type { database as databaseInstance } from "@/context";
import { enqueuePushSync } from "./enqueue-push-sync";
import { spawnBackgroundJob } from "./background-task";

const EMPTY_LIST_COUNT = 0;
const USER_MAPPING_LOCK_NAMESPACE = 9001;

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

export {
  USER_MAPPING_LOCK_NAMESPACE,
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  runWithMappingMutationLocks,
  withMappingMutationLocks,
  enqueueMappingReplacementSync,
  requestUserSync,
  scheduleMappingReplacementSync,
};
export type { MappingMutationSyncLock };

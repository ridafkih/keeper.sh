import {
  syncCalendar,
  getEventsForDestination,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createRedisRateLimiter,
} from "@keeper.sh/calendar";
import type { SyncProgressUpdate } from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import { resolveSyncProvider } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import { createSyncLock } from "./sync-lock";

const GOOGLE_REQUESTS_PER_MINUTE = 600;

interface SyncConfig {
  database: BunSQLDatabase;
  redis: Redis;
  encryptionKey?: string;
  oauthConfig: OAuthConfig;
}

interface SyncDestinationsResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  syncEvents: Record<string, unknown>[];
}

const EMPTY_RESULT: SyncDestinationsResult = {
  added: 0,
  addFailed: 0,
  removed: 0,
  removeFailed: 0,
  syncEvents: [],
};

interface SyncCallbacks {
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
}

const syncDestinationsForUser = async (
  userId: string,
  config: SyncConfig,
  callbacks?: SyncCallbacks,
): Promise<SyncDestinationsResult> => {
  const { database, redis } = config;

  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
      userId: calendarsTable.userId,
      accountId: calendarsTable.accountId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        arrayContains(calendarsTable.capabilities, ["push"]),
      ),
    );

  if (destinations.length === 0) {
    return EMPTY_RESULT;
  }

  const flush = createDatabaseFlush(database);
  const syncLock = createSyncLock(redis);

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;
  const syncEvents: Record<string, unknown>[] = [];

  const rateLimiter = createRedisRateLimiter(
    redis,
    `ratelimit:${userId}:google`,
    { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
  );

  for (const destination of destinations) {
    const lockResult = await syncLock.acquire(destination.calendarId);
    if (!lockResult.acquired) {
      continue;
    }

    const { handle } = lockResult;

    try {
      const syncProvider = await resolveSyncProvider({
        database,
        provider: destination.provider,
        calendarId: destination.calendarId,
        userId: destination.userId,
        accountId: destination.accountId,
        oauthConfig: config.oauthConfig,
        encryptionKey: config.encryptionKey,
        rateLimiter,
      });

      if (!syncProvider) {
        continue;
      }

      const providerRef = syncProvider;

      const result = await syncCalendar({
        userId: destination.userId,
        calendarId: destination.calendarId,
        provider: providerRef,
        readState: async () => ({
          localEvents: await getEventsForDestination(database, destination.calendarId),
          existingMappings: await getEventMappingsForDestination(database, destination.calendarId),
          remoteEvents: await providerRef.listRemoteEvents(),
        }),
        isCurrent: () => handle.isCurrent(),
        flush,
        onProgress: callbacks?.onProgress,
        onSyncEvent: (event) => {
          const enrichedEvent = {
            ...event,
            "destination.provider": destination.provider,
            "user.id": destination.userId,
          };
          syncEvents.push(enrichedEvent);
          if (callbacks?.onSyncEvent) {
            callbacks.onSyncEvent(enrichedEvent);
          }
        },
      });

      added += result.added;
      addFailed += result.addFailed;
      removed += result.removed;
      removeFailed += result.removeFailed;
    } finally {
      await handle.release();
    }
  }

  return { added, addFailed, removed, removeFailed, syncEvents };
};

export { syncDestinationsForUser };
export type { SyncConfig, SyncDestinationsResult };

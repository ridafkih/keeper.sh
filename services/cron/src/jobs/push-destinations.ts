import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import { createSyncAggregateRuntime } from "@keeper.sh/calendar";
import type { DestinationSyncResult } from "@keeper.sh/calendar";
import { syncDestinationsForUser } from "@keeper.sh/sync";
import type { SyncConfig } from "@keeper.sh/sync";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { syncStatusTable } from "@keeper.sh/database/schema";
import Redis from "ioredis";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { database, refreshLockRedis } from "@/context";
import { getUsersWithDestinationsByPlan } from "@/utils/get-sources";
import env from "@/env";

const resolveCount = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

const USER_TIMEOUT_MS = 300_000;
const REDIS_COMMAND_TIMEOUT_MS = 10_000;
const REDIS_MAX_RETRIES = 3;

const runEgressJob = async (plan: Plan): Promise<void> => {
  const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

  setCronEventFields({
    "subscription.plan": plan,
    "user.count": usersWithDestinations.length,
  });

  if (usersWithDestinations.length === 0) {
    return;
  }

  const redis = new Redis(env.REDIS_URL, {
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
  });

  const broadcastService = createBroadcastService({ redis: refreshLockRedis });

  const persistSyncStatus = async (result: DestinationSyncResult, syncedAt: Date): Promise<void> => {
    await database
      .insert(syncStatusTable)
      .values({
        calendarId: result.calendarId,
        lastSyncedAt: syncedAt,
        localEventCount: result.localEventCount,
        remoteEventCount: result.remoteEventCount,
      })
      .onConflictDoUpdate({
        set: {
          lastSyncedAt: syncedAt,
          localEventCount: result.localEventCount,
          remoteEventCount: result.remoteEventCount,
        },
        target: [syncStatusTable.calendarId],
      });
  };

  const syncAggregateRuntime = createSyncAggregateRuntime({
    broadcast: (userId, eventName, payload) => {
      broadcastService.emit(userId, eventName, payload);
    },
    persistSyncStatus,
    redis: refreshLockRedis,
  });

  const syncConfig: SyncConfig = {
    database,
    redis,
    encryptionKey: env.ENCRYPTION_KEY,
    oauthConfig: {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      microsoftClientId: env.MICROSOFT_CLIENT_ID,
      microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
    },
  };

  try {
    let totalAdded = 0;
    let totalAddFailed = 0;
    let totalRemoved = 0;
    let totalRemoveFailed = 0;
    let usersFailed = 0;
    const allSyncEvents: Record<string, unknown>[] = [];

    const settlements = await Promise.allSettled(
      usersWithDestinations.map((userId) => {
        const deadlineMs = Date.now() + USER_TIMEOUT_MS;
        return syncDestinationsForUser(userId, { ...syncConfig, deadlineMs }, {
          onProgress: (update) => {
            syncAggregateRuntime.onSyncProgress(update);
          },
          onSyncEvent: (syncEvent) => {
            const calendarId = syncEvent["calendar.id"];
            const localCount = syncEvent["local_events.count"];
            const remoteCount = syncEvent["remote_events.count"];

            if (typeof calendarId !== "string") {
              return;
            }

            syncAggregateRuntime.onDestinationSync({
              userId,
              calendarId,
              localEventCount: resolveCount(localCount),
              remoteEventCount: resolveCount(remoteCount),
            });
          },
        });
      }),
    );

    for (const settlement of settlements) {
      if (settlement.status === "fulfilled") {
        totalAdded += settlement.value.added;
        totalAddFailed += settlement.value.addFailed;
        totalRemoved += settlement.value.removed;
        totalRemoveFailed += settlement.value.removeFailed;
        allSyncEvents.push(...settlement.value.syncEvents);
      } else {
        usersFailed += 1;
        widelog.errorFields(settlement.reason, { prefix: "push.user" });
      }
    }

    setCronEventFields({
      "events.added": totalAdded,
      "events.add_failed": totalAddFailed,
      "events.removed": totalRemoved,
      "events.remove_failed": totalRemoveFailed,
      "user.failed": usersFailed,
      "sync_events": allSyncEvents,
    });
  } finally {
    redis.disconnect();
  }
};

const createPushJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    async callback() {
      setCronEventFields({ "job.type": "push-destinations", "subscription.plan": plan });
      await runEgressJob(plan);
    },
    cron,
    immediate: process.env.ENV !== "production",
    name: `push-destinations-${plan}`,
    overrunProtection: false,
  });

export default [
  createPushJob("free", "@every_30_minutes"),
  createPushJob("pro", "@every_1_minutes"),
];

import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import { getEventsForDestination, getEventMappingsForDestination } from "@keeper.sh/calendar";
import { syncCalendar } from "@keeper.sh/sync-engine";
import { createRedisGenerationCheck } from "@keeper.sh/sync-engine/generation";
import { createDatabaseFlush } from "@keeper.sh/sync-engine/flush";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const USER_TIMEOUT_MS = 300_000;
const REDIS_COMMAND_TIMEOUT_MS = 10_000;
const REDIS_MAX_RETRIES = 3;

const withTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
  label: string,
): Promise<TResult> =>
  Promise.race([
    Promise.resolve().then(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }),
  ]);

const runEgressJob = async (plan: Plan): Promise<void> => {
  const [contextModule, sourcesModule] = await Promise.all([
    import("@/context"),
    import("@/utils/get-sources"),
  ]);

  const { database, createSyncContext } = contextModule;
  const { getUsersWithDestinationsByPlan } = sourcesModule;

  const ioredis = await import("ioredis");
  const Redis = ioredis.default;
  const { calendarsTable, sourceDestinationMappingsTable } = await import("@keeper.sh/database/schema");
  const { eq } = await import("drizzle-orm");

  const envModule = await import("@/env");
  const env = envModule.default;

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

  const syncContext = createSyncContext();
  const flush = createDatabaseFlush(database);

  try {
    let totalAdded = 0;
    let totalAddFailed = 0;
    let totalRemoved = 0;
    let totalRemoveFailed = 0;
    let usersFailed = 0;

    const settlements = await Promise.allSettled(
      usersWithDestinations.map((userId) =>
        withTimeout(
          async () => {
            const destinationRows = await database
              .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
              .from(sourceDestinationMappingsTable)
              .innerJoin(calendarsTable, eq(calendarsTable.id, sourceDestinationMappingsTable.destinationCalendarId))
              .where(eq(calendarsTable.userId, userId));

            for (const row of destinationRows) {
              const isCurrent = await createRedisGenerationCheck(redis, row.id);

              const result = await syncCalendar({
                calendarId: row.id,
                provider: {
                  pushEvents: () => Promise.resolve([]),
                  deleteEvents: () => Promise.resolve([]),
                  listRemoteEvents: () => Promise.resolve([]),
                },
                readState: async () => ({
                  localEvents: await getEventsForDestination(database, row.id),
                  existingMappings: await getEventMappingsForDestination(database, row.id),
                  remoteEvents: [],
                }),
                isCurrent,
                flush,
              });

              totalAdded += result.added;
              totalAddFailed += result.addFailed;
              totalRemoved += result.removed;
              totalRemoveFailed += result.removeFailed;
            }
          },
          USER_TIMEOUT_MS,
          `push:user:${userId}`,
        ),
      ),
    );

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
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
    });
  } finally {
    syncContext.close();
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

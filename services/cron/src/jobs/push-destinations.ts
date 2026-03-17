import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { getUsersWithDestinationsByPlan } from "@/utils/get-sources";
import env from "@/env";

const runEgressJob = async (plan: Plan): Promise<void> => {
  const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

  const correlationId = crypto.randomUUID();

  widelog.set("batch.plan", plan);
  widelog.set("batch.user_count", usersWithDestinations.length);
  widelog.set("batch.jobs_enqueued", usersWithDestinations.length);
  widelog.set("correlation.id", correlationId);

  if (usersWithDestinations.length === 0) {
    return;
  }

  const queue = createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null });

  try {
    await queue.addBulk(
      usersWithDestinations.map((userId) => ({
        name: `sync-${userId}`,
        data: { userId, plan, correlationId } satisfies PushSyncJobPayload,
      })),
    );
  } finally {
    await queue.close();
  }
};

const createPushJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    async callback() {
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

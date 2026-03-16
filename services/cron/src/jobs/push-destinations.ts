import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import { createPushSyncQueue } from "@keeper.sh/queue";
import type { PushSyncJobPayload } from "@keeper.sh/queue";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { getUsersWithDestinationsByPlan } from "@/utils/get-sources";
import env from "@/env";

const runEgressJob = async (plan: Plan): Promise<void> => {
  const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

  if (usersWithDestinations.length === 0) {
    return;
  }

  const queue = createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null });

  try {
    await queue.addBulk(
      usersWithDestinations.map((userId) => ({
        name: `sync-${userId}`,
        data: { userId, plan } satisfies PushSyncJobPayload,
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

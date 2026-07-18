import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import { createPushSyncQueue } from "@keeper.sh/queue";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { getDestinationCalendarsByPlan } from "@/utils/get-sources";
import env from "@/env";
import { buildPushDestinationJobs } from "./push-destination-jobs";

const runEgressJob = async (plan: Plan): Promise<void> => {
  if (env.WORKER_JOB_QUEUE_ENABLED === false) {
    return;
  }

  const destinations = await getDestinationCalendarsByPlan(plan);
  const userCount = new Set(destinations.map(({ userId }) => userId)).size;

  const correlationId = crypto.randomUUID();

  widelog.set("batch.plan", plan);
  widelog.set("batch.user_count", userCount);
  widelog.set("batch.destination_count", destinations.length);
  widelog.set("batch.jobs_enqueued", destinations.length);
  widelog.set("correlation.id", correlationId);

  if (destinations.length === 0) {
    return;
  }

  const queue = createPushSyncQueue({ url: env.REDIS_URL, maxRetriesPerRequest: null });

  try {
    await queue.addBulk(
      buildPushDestinationJobs(destinations, plan, correlationId),
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

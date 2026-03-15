import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import type { DestinationProvider, SyncCoordinator } from "@keeper.sh/calendar";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const USER_TIMEOUT_MS = 300_000;

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

const syncSingleUser = async (
  userId: string,
  plan: Plan,
  syncContext: { destinationProviders: DestinationProvider[]; syncCoordinator: SyncCoordinator },
): Promise<{ added: number; addFailed: number; removed: number; removeFailed: number }> => {
  const { syncDestinationsForUser } = await import("@keeper.sh/calendar");

  return syncDestinationsForUser(
    userId,
    syncContext.destinationProviders,
    syncContext.syncCoordinator,
    { jobName: `push-destinations-${plan}`, jobType: "push-destinations" },
  );
};

const runEgressJob = async (plan: Plan): Promise<void> => {
  const [{ createSyncContext }, { getUsersWithDestinationsByPlan }] = await Promise.all([
    import("@/context"),
    import("@/utils/get-sources"),
  ]);

  const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

  setCronEventFields({
    "subscription.plan": plan,
    "user.count": usersWithDestinations.length,
  });

  if (usersWithDestinations.length === 0) {
    return;
  }

  const syncContext = createSyncContext();

  try {
    let totalAdded = 0;
    let totalAddFailed = 0;
    let totalRemoved = 0;
    let totalRemoveFailed = 0;
    let usersFailed = 0;

    const settlements = await Promise.allSettled(
      usersWithDestinations.map((userId) =>
        withTimeout(
          () => syncSingleUser(userId, plan, syncContext),
          USER_TIMEOUT_MS,
          `push:user:${userId}`,
        ),
      ),
    );

    for (const settlement of settlements) {
      if (settlement.status === "fulfilled") {
        totalAdded += settlement.value.added;
        totalAddFailed += settlement.value.addFailed;
        totalRemoved += settlement.value.removed;
        totalRemoveFailed += settlement.value.removeFailed;
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
    });
  } finally {
    syncContext.close();
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

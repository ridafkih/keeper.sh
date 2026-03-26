import type { CronOptions } from "cronbake";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { user } from "@keeper.sh/database/auth-schema";
import { createProductPlanMapping } from "@keeper.sh/premium";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const EMPTY_SUBSCRIPTIONS_COUNT = 0;

interface ReconcileSubscriptionsDependencies {
  hasBillingClient: boolean;
  selectUserIds: () => Promise<string[]>;
  reconcileUserSubscription: (userId: string) => Promise<void>;
  reconcileUserTimeoutMs?: number;
}

const RECONCILE_USER_TIMEOUT_MS = 60_000;

const invokeOperation = <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => operation();

const withOperationTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
  operationName: string,
): Promise<TResult> =>
  Promise.race([
    invokeOperation(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`${operationName} timed out after ${timeoutMs}ms`);
    }),
  ]);

const runReconcileSubscriptionsJob = async (
  dependencies: ReconcileSubscriptionsDependencies,
): Promise<void> => {
  if (!dependencies.hasBillingClient) {
    return;
  }

  const userIds = await dependencies.selectUserIds();
  const reconcileUserTimeoutMs = dependencies.reconcileUserTimeoutMs ?? RECONCILE_USER_TIMEOUT_MS;

  const settlements = await Promise.allSettled(
    userIds.map((userId) =>
      withOperationTimeout(
        () => dependencies.reconcileUserSubscription(userId),
        reconcileUserTimeoutMs,
        `reconcile:subscription:${userId}`,
      )),
  );

  const failedCount = settlements.filter((settlement) => settlement.status === "rejected").length;

  widelog.set("batch.processed_count", userIds.length);
  widelog.set("batch.failed_count", failedCount);
};

const createDefaultDependencies = async (): Promise<ReconcileSubscriptionsDependencies> => {
  const { database, polarClient } = await import("@/context");
  const env = (await import("@/env")).default;

  const planMapping = createProductPlanMapping({
    proProductIds: env.POLAR_PRO_PRODUCT_IDS,
    unlimitedProductIds: env.POLAR_UNLIMITED_PRODUCT_IDS,
  });

  return {
    hasBillingClient: Boolean(polarClient),
    reconcileUserSubscription: async (userId) => {
      if (!polarClient) {
        return;
      }

      const subscriptions = await polarClient.subscriptions.list({
        active: true,
        externalCustomerId: userId,
      });

      const hasActiveSubscription = subscriptions.result.items.length > EMPTY_SUBSCRIPTIONS_COUNT;
      const [polarSubscription] = subscriptions.result.items;

      if (hasActiveSubscription && polarSubscription) {
        const plan = planMapping.resolveProductPlan(polarSubscription.productId);
        const polarSubscriptionId = polarSubscription.id;

        await database
          .insert(userSubscriptionsTable)
          .values({
            plan,
            polarSubscriptionId,
            userId,
          })
          .onConflictDoUpdate({
            set: {
              plan,
              polarSubscriptionId,
            },
            target: userSubscriptionsTable.userId,
          });
      } else {
        await database
          .insert(userSubscriptionsTable)
          .values({
            polarSubscriptionId: null,
            userId,
          })
          .onConflictDoUpdate({
            set: {
              polarSubscriptionId: null,
            },
            target: userSubscriptionsTable.userId,
          });
      }
    },
    selectUserIds: async () => {
      const users = await database.select({ id: user.id }).from(user);
      return users.map((userRecord) => userRecord.id);
    },
  };
};

export default withCronWideEvent({
  async callback() {
    const dependencies = await createDefaultDependencies();
    await runReconcileSubscriptionsJob(dependencies);
  },
  cron: "0 0 * * * *",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

export { runReconcileSubscriptionsJob };

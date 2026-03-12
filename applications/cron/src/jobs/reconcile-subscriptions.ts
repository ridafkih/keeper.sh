import type { CronOptions } from "cronbake";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { user } from "@keeper.sh/database/auth-schema";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { countSettledResults } from "../utils/count-settled-results";
import { widelog } from "../utils/logging";

const EMPTY_SUBSCRIPTIONS_COUNT = 0;
const INITIAL_PROCESSED_COUNT = 0;

const getPlanFromSubscriptionStatus = (hasActive: boolean): "pro" | "free" => {
  if (hasActive) {
    return "pro";
  }
  return "free";
};

interface ReconcileSubscriptionsDependencies {
  hasBillingClient: boolean;
  selectUserIds: () => Promise<string[]>;
  reconcileUserSubscription: (userId: string) => Promise<void>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
  reportError?: (error: unknown, fields?: Record<string, unknown>) => void;
}

const runReconcileSubscriptionsJob = async (
  dependencies: ReconcileSubscriptionsDependencies,
): Promise<void> => {
  if (!dependencies.hasBillingClient) {
    dependencies.setCronEventFields({ "processed.count": INITIAL_PROCESSED_COUNT });
    return;
  }

  const userIds = await dependencies.selectUserIds();
  dependencies.setCronEventFields({ "processed.count": userIds.length });

  const settlements = await Promise.allSettled(
    userIds.map((userId) => dependencies.reconcileUserSubscription(userId)),
  );

  for (const [index, settlement] of settlements.entries()) {
    if (settlement.status === "rejected") {
      const userId = userIds[index];
      dependencies.reportError?.(settlement.reason, {
        "operation.name": "reconcile-subscriptions:user",
        ...(userId && { "user.id": userId }),
      });
    }
  }

  const { failed } = countSettledResults(settlements);
  dependencies.setCronEventFields({ "failed.count": failed });
};

const createDefaultDependencies = async (): Promise<ReconcileSubscriptionsDependencies> => {
  const { database, polarClient } = await import("../context");

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
      const plan = getPlanFromSubscriptionStatus(hasActiveSubscription);

      const [polarSubscription] = subscriptions.result.items;
      const polarSubscriptionId = polarSubscription?.id ?? null;

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
    },
    reportError: (error: unknown, fields?: Record<string, unknown>) => {
      if (fields) {
        for (const [key, value] of Object.entries(fields)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            widelog.set(key, value);
          }
        }
      }
      widelog.errorFields(error);
    },
    selectUserIds: async () => {
      const users = await database.select({ id: user.id }).from(user);
      return users.map((userRecord) => userRecord.id);
    },
    setCronEventFields,
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

import type { CronOptions } from "cronbake";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { user } from "@keeper.sh/database/auth-schema";
import { database, polarClient } from "../context";
import { withCronWideEvent, setCronEventFields } from "../utils/with-wide-event";

const reconcileUserSubscription = async (userId: string) => {
  if (!polarClient) return;

  try {
    const subscriptions = await polarClient.subscriptions.list({
      externalCustomerId: userId,
      active: true,
    });

    const hasActiveSubscription = subscriptions.result.items.length > 0;
    const plan = hasActiveSubscription ? "pro" : "free";

    const [polarSubscription] = subscriptions.result.items;
    const polarSubscriptionId = polarSubscription?.id ?? null;

    await database
      .insert(userSubscriptionsTable)
      .values({
        userId,
        plan,
        polarSubscriptionId,
      })
      .onConflictDoUpdate({
        target: userSubscriptionsTable.userId,
        set: {
          plan,
          polarSubscriptionId,
        },
      });

  } catch {
  }
}

const countReconciliationResults = (
  results: PromiseSettledResult<void>[]
): { succeeded: number; failed: number } => {
  const succeeded = results.filter(
    (result) => result.status === "fulfilled"
  ).length;
  const failed = results.filter(
    (result) => result.status === "rejected"
  ).length;
  return { succeeded, failed };
};

export default withCronWideEvent({
  name: import.meta.file,
  cron: "0 0 * * * *",
  immediate: true,
  async callback() {
    if (!polarClient) {
      setCronEventFields({ processedCount: 0 });
      return;
    }

    const users = await database.select({ id: user.id }).from(user);
    setCronEventFields({ processedCount: users.length });

    const reconciliations = users.map((userRecord) =>
      reconcileUserSubscription(userRecord.id)
    );

    const results = await Promise.allSettled(reconciliations);
    const { failed } = countReconciliationResults(results);
    setCronEventFields({ failedCount: failed });
  },
}) satisfies CronOptions;

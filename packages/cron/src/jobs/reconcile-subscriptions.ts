import type { CronOptions } from "cronbake";
import { polarClient } from "@keeper.sh/auth";
import { database } from "@keeper.sh/database";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { user } from "@keeper.sh/database/auth-schema";
import { log } from "@keeper.sh/log";

async function reconcileUserSubscription(userId: string) {
  if (!polarClient) return;

  try {
    const subscriptions = await polarClient.subscriptions.list({
      externalCustomerId: userId,
      active: true,
    });

    const hasActiveSubscription = subscriptions.result.items.length > 0;
    const plan = hasActiveSubscription ? "pro" : "free";
    const polarSubscriptionId = subscriptions.result.items[0]?.id ?? null;

    await database
      .insert(userSubscriptionsTable)
      .values({
        userId,
        plan,
        polarSubscriptionId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSubscriptionsTable.userId,
        set: {
          plan,
          polarSubscriptionId,
          updatedAt: new Date(),
        },
      });

    log.debug("reconciled user '%s' to plan '%s'", userId, plan);
  } catch (error) {
    log.error(error, "failed to reconcile subscription for user '%s'", userId);
  }
}

export default {
  name: import.meta.file,
  cron: "0 0 * * * *",
  immediate: true,
  async callback() {
    if (!polarClient) {
      log.debug("polar client not configured, skipping reconciliation");
      return;
    }

    const users = await database.select({ id: user.id }).from(user);
    log.info("reconciling subscriptions for %s users", users.length);

    const reconciliations = users.map((user) =>
      reconcileUserSubscription(user.id),
    );
    await Promise.allSettled(reconciliations);

    log.info("subscription reconciliation complete");
  },
} satisfies CronOptions;

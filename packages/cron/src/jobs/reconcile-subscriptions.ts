import type { CronOptions } from "cronbake";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { user } from "@keeper.sh/database/auth-schema";
import { getWideEvent } from "@keeper.sh/log";
import { database, polarClient } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { countSettledResults } from "../utils/count-settled-results";

const EMPTY_SUBSCRIPTIONS_COUNT = 0;
const INITIAL_PROCESSED_COUNT = 0;

const getPlanFromSubscriptionStatus = (hasActive: boolean): "pro" | "free" => {
  if (hasActive) {
    return "pro";
  }
  return "free";
};

const reconcileUserSubscription = async (userId: string): Promise<void> => {
  if (!polarClient) {
    return;
  }

  try {
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
  } catch (error) {
    getWideEvent()?.setError(error);
  }
};

export default withCronWideEvent({
  async callback() {
    if (!polarClient) {
      setCronEventFields({ processedCount: INITIAL_PROCESSED_COUNT });
      return;
    }

    const users = await database.select({ id: user.id }).from(user);
    setCronEventFields({ processedCount: users.length });

    const reconciliations = users.map((userRecord) => reconcileUserSubscription(userRecord.id));

    const results = await Promise.allSettled(reconciliations);
    const { failed } = countSettledResults(results);
    setCronEventFields({ failedCount: failed });
  },
  cron: "0 0 * * * *",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

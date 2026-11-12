import type { Plan } from "@keeper.sh/data-schemas";

interface PolarSubscriptionEvent {
  type: string;
  subscriptionId: string;
  externalCustomerId: string | null;
}

interface PolarSubscriptionSyncDependencies {
  fetchActiveSubscriptionIds: (externalCustomerId: string) => Promise<string[]>;
  upsertSubscription: (
    userId: string,
    plan: Plan,
    polarSubscriptionId: string,
  ) => Promise<void>;
  observe: (fields: Record<string, number | string>) => void;
}

interface PolarSubscriptionSyncResult {
  plan: Plan;
  polarSubscriptionId: string;
}

const isSubscriptionEvent = (type: string): boolean => type.startsWith("subscription.");

const resolvePlan = (activeSubscriptionIds: string[]): Plan => {
  if (activeSubscriptionIds.length > 0) {
    return "pro";
  }
  return "free";
};

const syncPolarSubscription = async (
  event: PolarSubscriptionEvent,
  dependencies: PolarSubscriptionSyncDependencies,
): Promise<PolarSubscriptionSyncResult | null> => {
  if (!isSubscriptionEvent(event.type) || !event.externalCustomerId) {
    return null;
  }

  const activeSubscriptionIds = await dependencies.fetchActiveSubscriptionIds(
    event.externalCustomerId,
  );
  const plan = resolvePlan(activeSubscriptionIds);
  const [activeSubscriptionId] = activeSubscriptionIds;
  const polarSubscriptionId = activeSubscriptionId ?? event.subscriptionId;

  dependencies.observe({
    "webhook.active_subscription_count": activeSubscriptionIds.length,
    "webhook.resulting_plan": plan,
  });

  await dependencies.upsertSubscription(event.externalCustomerId, plan, polarSubscriptionId);
  return { plan, polarSubscriptionId };
};

export { syncPolarSubscription };
export type {
  PolarSubscriptionEvent,
  PolarSubscriptionSyncDependencies,
  PolarSubscriptionSyncResult,
};

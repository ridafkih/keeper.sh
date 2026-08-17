import type { Instant } from "@keeper.sh/sync-protocol";
import type { GraphSubscription } from "./subscription";

interface ReconcileInputs {
  readonly listed: readonly GraphSubscription[];
  readonly ourNotificationUrl: string;
  readonly tickStartedAt: Instant;
  readonly keep: readonly string[];
}

interface ReconcilePlan {
  readonly deletable: readonly string[];
  readonly foreign: readonly string[];
  readonly protectedByTick: readonly string[];
}

const ownsNotificationUrl = (ourUrl: string, presented: string): boolean => {
  if (presented === ourUrl) {
    return true;
  }
  return presented.startsWith(`${ourUrl}/`);
};

const startedAfter = (subscription: GraphSubscription, tickStartedAt: Instant): boolean =>
  Date.parse(subscription.createdAt.value) >= Date.parse(tickStartedAt.value);

const reconcileSubscriptions = (inputs: ReconcileInputs): ReconcilePlan => {
  const deletable: string[] = [];
  const foreign: string[] = [];
  const protectedByTick: string[] = [];
  for (const subscription of inputs.listed) {
    if (!ownsNotificationUrl(inputs.ourNotificationUrl, subscription.notificationUrl)) {
      foreign.push(subscription.id);
      continue;
    }
    if (startedAfter(subscription, inputs.tickStartedAt)) {
      protectedByTick.push(subscription.id);
      continue;
    }
    if (inputs.keep.includes(subscription.id)) {
      continue;
    }
    deletable.push(subscription.id);
  }
  return { deletable, foreign, protectedByTick };
};

export { ownsNotificationUrl, reconcileSubscriptions };
export type { ReconcileInputs, ReconcilePlan };

import type { Instant } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const subscriptionResources = ["events"] as const;
type SubscriptionResource = (typeof subscriptionResources)[number];

const minuteMs = 60 * 1000;

const graphLifetimeMinutes = {
  events: { basic: 10_080, withResourceData: 1440 },
} as const;

const lifetimeFloorMs = 45 * minuteMs;
const lifetimeSafetyMarginMs = 30 * minuteMs;
const staggerShare = 10;

const subscriptionLifetimeMs = (
  resource: SubscriptionResource,
  includeResourceData: boolean,
): number => {
  switch (resource) {
    case "events": {
      if (includeResourceData) {
        return graphLifetimeMinutes.events.withResourceData * minuteMs;
      }
      return graphLifetimeMinutes.events.basic * minuteMs;
    }
    default: {
      return assertNever(resource);
    }
  }
};

const boundedFraction = (fraction: number): number => Math.min(1, Math.max(0, fraction));

const staggerOffsetMs = (lifetimeMs: number, randomFraction: () => number): number =>
  Math.round((boundedFraction(randomFraction()) * lifetimeMs) / staggerShare);

const instantAt = (milliseconds: number): Instant => ({
  kind: "instant",
  value: new Date(milliseconds).toISOString(),
});

const renewalInstantOf = (
  expiration: Instant,
  lifetimeMs: number,
  randomFraction: () => number,
): Instant => {
  const expiring = Date.parse(expiration.value);
  const offset = staggerOffsetMs(lifetimeMs, randomFraction);
  return instantAt(expiring - lifetimeSafetyMarginMs - offset);
};

const expirationInstantOf = (
  now: Instant,
  requestedMs: number,
  resource: SubscriptionResource,
  includeResourceData: boolean,
): Instant => {
  const ceiling = subscriptionLifetimeMs(resource, includeResourceData) - lifetimeSafetyMarginMs;
  const granted = Math.min(ceiling, Math.max(lifetimeFloorMs, requestedMs));
  return instantAt(Date.parse(now.value) + granted);
};

export {
  expirationInstantOf,
  graphLifetimeMinutes,
  lifetimeFloorMs,
  lifetimeSafetyMarginMs,
  renewalInstantOf,
  staggerOffsetMs,
  subscriptionLifetimeMs,
  subscriptionResources,
};
export type { SubscriptionResource };

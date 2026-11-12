import { type } from "arktype";
import { BILLING_LIMIT_TYPES, ONBOARDING_FUNNEL_STEPS } from "@keeper.sh/data-schemas";
import type { FunnelEvent } from "@keeper.sh/data-schemas";

const MAX_SAME_ACCOUNT_CALENDARS = 1000;

const onboardingStepViewedSchema = type({
  event: "'onboarding.step_viewed'",
  firstAccountProvider: /^[a-z0-9-]{1,32}$/,
  sameAccountCalendars: `0 <= number.integer <= ${MAX_SAME_ACCOUNT_CALENDARS}`,
  step: type.enumerated(...ONBOARDING_FUNNEL_STEPS),
  "+": "reject",
});

const billingLimitShownSchema = type({
  event: "'billing.limit_shown'",
  limitType: type.enumerated(...BILLING_LIMIT_TYPES),
  "+": "reject",
});

const billingUpgradeViewedSchema = type({
  event: "'billing.upgrade_viewed'",
  "+": "reject",
});

const funnelEventSchema = onboardingStepViewedSchema.or(billingLimitShownSchema).or(billingUpgradeViewedSchema);

const parseFunnelEvent = (body: unknown): FunnelEvent | null => {
  const event = funnelEventSchema(body);
  if (event instanceof type.errors) {
    return null;
  }
  return event;
};

const describeFunnelEvent = (event: FunnelEvent): Record<string, string | number> => {
  if (event.event === "onboarding.step_viewed") {
    return {
      "funnel.event": event.event,
      "onboarding.first_account_provider": event.firstAccountProvider,
      "onboarding.same_account_calendars": event.sameAccountCalendars,
      "onboarding.step": event.step,
    };
  }
  if (event.event === "billing.limit_shown") {
    return {
      "billing.limit_type": event.limitType,
      "funnel.event": event.event,
    };
  }
  return { "funnel.event": event.event };
};

export { describeFunnelEvent, parseFunnelEvent };

const ONBOARDING_FUNNEL_STEPS = [
  "welcome",
  "add-destination",
  "ready",
  "copying",
  "copied",
  "nothing-to-copy",
  "home",
] as const;

const BILLING_LIMIT_TYPES = [
  "accounts",
  "mappings",
  "ical_feeds",
  "feed_settings",
  "event_filters",
  "sync_window",
  "advanced_sync",
  "event_exclusions",
  "syncs",
  "sync_calendars",
] as const;

const FUNNEL_EVENT_PATH = "/api/funnel";

type OnboardingFunnelStep = (typeof ONBOARDING_FUNNEL_STEPS)[number];
type BillingLimitType = (typeof BILLING_LIMIT_TYPES)[number];

interface OnboardingStepViewedEvent {
  event: "onboarding.step_viewed";
  step: OnboardingFunnelStep;
  firstAccountProvider: string;
  sameAccountCalendars: number;
}

interface BillingLimitShownEvent {
  event: "billing.limit_shown";
  limitType: BillingLimitType;
}

interface BillingUpgradeViewedEvent {
  event: "billing.upgrade_viewed";
}

type FunnelEvent = OnboardingStepViewedEvent | BillingLimitShownEvent | BillingUpgradeViewedEvent;

export { BILLING_LIMIT_TYPES, FUNNEL_EVENT_PATH, ONBOARDING_FUNNEL_STEPS };
export type {
  BillingLimitShownEvent,
  BillingLimitType,
  BillingUpgradeViewedEvent,
  FunnelEvent,
  OnboardingFunnelStep,
  OnboardingStepViewedEvent,
};

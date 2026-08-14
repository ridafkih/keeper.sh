import type { MarketingPricingFeatureValueKind } from "./components/marketing-pricing-section";

export type PricingPlan = {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  ctaLabel: string;
  tone?: "default" | "inverse";
};

export type PricingFeature = {
  label: string;
  free: MarketingPricingFeatureValueKind;
  pro: MarketingPricingFeatureValueKind;
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'per month',
    description:
      'For personal use and getting started with calendar sync.',
    ctaLabel: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5',
    period: 'per month',
    description:
      'For power users who need fast syncs, advanced feed controls, and unlimited syncing.',
    ctaLabel: 'Get Started',
    tone: "inverse" as const,
  },
];

export const PRICING_FEATURES: PricingFeature[] = [
  { label: 'Reading Your Calendars', free: 'Every 1 minute', pro: 'Every 1 minute' },
  { label: 'Updating Your Calendars', free: 'Every 30 minutes', pro: 'Every 1 minute' },
  { label: 'Linked Accounts', free: 'Up to 2', pro: 'infinity' },
  { label: 'Sync Mappings', free: 'Up to 3', pro: 'infinity' },
  { label: 'Aggregated iCal Feed', free: 'check', pro: 'check' },
  { label: 'iCal Feed Customization', free: 'minus', pro: 'check' },
  { label: 'Event Filters & Exclusions', free: 'minus', pro: 'check' },
  { label: 'API & MCP Access', free: '25 calls/day', pro: 'infinity' },
  { label: 'Email & Passkey Sign-In', free: 'check', pro: 'check' },
  { label: 'Priority Support', free: 'minus', pro: 'check' },
];

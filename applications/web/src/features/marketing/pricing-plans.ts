import type { MarketingPricingFeatureValueKind } from "./components/marketing-pricing-section";

export type PricingPlanId = 'free' | 'pro';


export type PricingPlan = {
  id: PricingPlanId;
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
  /**
   * Short noun phrase for the plan cards, per plan. Rows without one for a plan
   * stay in the matrix only. The card bullets are read from here so a plan
   * limit is written down once and the two surfaces cannot drift.
   */
  highlight?: Partial<Record<PricingPlanId, string>>;
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'per month',
    description:
      'For keeping two calendar accounts from double-booking each other.',
    ctaLabel: 'Start for Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5',
    period: 'per month',
    description:
      'For more than two calendar accounts, or when you need updates within the minute.',
    ctaLabel: 'Get Pro',
    tone: "inverse" as const,
  },
];

export const PRICING_FEATURES: PricingFeature[] = [
  {
    label: 'Updates from Google and Outlook',
    free: 'Every 30 minutes',
    pro: 'Within seconds',
    highlight: {
      free: 'Updates every 30 minutes',
      pro: 'Updates from Google and Outlook within seconds',
    },
  },
  {
    // Free carries no bullet here: it is the same 30 minutes as the row above,
    // and the cards would otherwise repeat it.
    label: 'Updates from iCloud, Fastmail and CalDAV',
    free: 'Every 30 minutes',
    pro: 'Within a minute',
    highlight: { pro: 'Updates from iCloud, Fastmail and CalDAV within a minute' },
  },
  {
    label: 'Linked Accounts',
    free: 'Up to 2',
    pro: 'infinity',
    highlight: { free: 'Up to 2 linked accounts', pro: 'Unlimited linked accounts' },
  },
  {
    label: 'Connections',
    free: 'Up to 3',
    pro: 'infinity',
    highlight: { free: 'Up to 3 connections', pro: 'Unlimited connections' },
  },
  { label: 'Shareable Calendar Link', free: 'check', pro: 'check' },
  { label: 'Choose What the Link Shows', free: 'minus', pro: 'check' },
  {
    label: 'Choose Which Events Sync',
    free: 'minus',
    pro: 'check',
    highlight: { pro: 'Choose which events sync' },
  },
  {
    label: 'AI Agent and API Access',
    free: '25 calls/day',
    pro: 'infinity',
    highlight: { free: '25 agent or API calls a day', pro: 'Unlimited agent and API calls' },
  },
  { label: 'Email & Passkey Sign-In', free: 'check', pro: 'check' },
  { label: 'Priority Support', free: 'minus', pro: 'check' },
];

/**
 * The rows where Free and Pro actually differ, in PRICING_FEATURES order. A row
 * that reads the same on both plans cannot decide the one question the landing
 * page asks — is Free enough for me — so it only costs vertical space there.
 * Derived rather than hand-listed, so this can never drift from the /pricing
 * matrix, which keeps every row.
 */
export const PRICING_FEATURE_DIFFERENCES: PricingFeature[] = PRICING_FEATURES.filter(
  (feature) => feature.free !== feature.pro,
);

/**
 * The rows that separate the plans, as card bullets for one plan. Order follows
 * PRICING_FEATURES so the cards read in the same order as the matrix. Derived
 * from the same rows the matrix renders, so the bullets shown below `md` and
 * the table shown at `md` and up cannot disagree.
 */
export function pricingPlanHighlights(planId: PricingPlanId): string[] {
  return PRICING_FEATURES.flatMap((feature) => feature.highlight?.[planId] ?? []);
}

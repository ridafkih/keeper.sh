import type { MarketingPricingFeatureValueKind } from "./components/marketing-pricing-section";
import { type PricingPlanId, resolvePricingFeatures } from "./pricing-layout";
import { marketingCopy } from "@/lib/marketing-copy";

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

/**
 * Presentation held in the app: which plan is emphasised. The cell layout lives
 * in pricing-layout.ts. The copy — plan names, prices, row labels, cell words
 * and card bullets — comes from the seo submodule under
 * marketing/pricing-plans.json and is merged in below by id.
 */
const PLAN_TONES: Partial<Record<PricingPlanId, "inverse">> = { pro: "inverse" };

export const PRICING_PLANS: PricingPlan[] = marketingCopy.pricingPlans.plans.map((plan) => {
  const id = plan.id as PricingPlanId;
  const tone = PLAN_TONES[id];

  return {
    id,
    name: plan.name,
    price: plan.price,
    period: plan.period,
    description: plan.description,
    ctaLabel: plan.ctaLabel,
    ...(tone ? { tone } : {}),
  };
});

export const PRICING_FEATURES: PricingFeature[] = resolvePricingFeatures(marketingCopy.pricingPlans.features);

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

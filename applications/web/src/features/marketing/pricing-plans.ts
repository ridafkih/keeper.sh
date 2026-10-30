import type { MarketingPricingFeatureValueKind } from "./components/marketing-pricing-section";
import { marketingCopy } from "@/lib/marketing-copy";

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

/**
 * Presentation held in the app: which plan is emphasised, and which matrix
 * cells render an icon rather than a word. The copy — plan names, prices, row
 * labels, cell words and card bullets — comes from the seo submodule under
 * marketing/pricing-plans.json and is merged in below by id.
 */
const PLAN_TONES: Partial<Record<PricingPlanId, "inverse">> = { pro: "inverse" };

type FeatureIcon = "check" | "minus" | "infinity";
type FeatureCell = FeatureIcon | "copy";

const FEATURE_CELLS: { id: string; free: FeatureCell; pro: FeatureCell }[] = [
  { id: "google-outlook-updates", free: "copy", pro: "copy" },
  { id: "caldav-updates", free: "copy", pro: "copy" },
  { id: "linked-accounts", free: "copy", pro: "infinity" },
  { id: "connections", free: "copy", pro: "infinity" },
  { id: "shareable-link", free: "check", pro: "check" },
  { id: "choose-link-shows", free: "minus", pro: "check" },
  { id: "choose-events-sync", free: "minus", pro: "check" },
  { id: "api-access", free: "copy", pro: "infinity" },
  { id: "sign-in", free: "check", pro: "check" },
  { id: "priority-support", free: "minus", pro: "check" },
];

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

const featureCopyById = new Map(
  marketingCopy.pricingPlans.features.map((feature) => [feature.id, feature] as const),
);

function resolveCell(
  cell: FeatureCell,
  word: string | undefined,
  id: string,
  column: "free" | "pro",
): MarketingPricingFeatureValueKind {
  if (cell !== "copy") return cell;

  if (!word) {
    throw new Error(`Pricing feature "${id}" is missing its ${column} word in the marketing collection.`);
  }

  return word;
}

export const PRICING_FEATURES: PricingFeature[] = FEATURE_CELLS.map((cell) => {
  const copy = featureCopyById.get(cell.id);

  if (!copy) {
    throw new Error(`Pricing feature "${cell.id}" has no copy in the marketing collection.`);
  }

  return {
    label: copy.label,
    free: resolveCell(cell.free, copy.free, cell.id, "free"),
    pro: resolveCell(cell.pro, copy.pro, cell.id, "pro"),
    ...(copy.highlight ? { highlight: copy.highlight } : {}),
  };
});

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

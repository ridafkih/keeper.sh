export const PRICING_PLAN_IDS = ["free", "pro"] as const;

export type PricingPlanId = (typeof PRICING_PLAN_IDS)[number];

type FeatureIcon = "check" | "minus" | "infinity";

type FeatureCell = FeatureIcon | "copy";

type PricingFeatureValue = FeatureIcon | (string & {});

interface PricingFeatureCopy {
  id: string;
  label: string;
  free?: string;
  pro?: string;
  highlight?: Partial<Record<PricingPlanId, string>>;
}

interface ResolvedPricingFeature {
  label: string;
  free: PricingFeatureValue;
  pro: PricingFeatureValue;
  highlight?: Partial<Record<PricingPlanId, string>>;
}

/**
 * Presentation held in the app: which matrix cells render an icon rather than
 * a word. Every row needs copy from the marketing collection, and every "copy"
 * cell needs its word there. The default copy is derived from this list, so it
 * always covers it.
 */
export const FEATURE_CELLS = [
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
] as const satisfies readonly { id: string; free: FeatureCell; pro: FeatureCell }[];

function resolveCell(
  cell: FeatureCell,
  word: string | undefined,
  id: string,
  column: PricingPlanId,
): PricingFeatureValue {
  if (cell !== "copy") return cell;

  if (!word) {
    throw new Error(`Pricing feature "${id}" is missing its ${column} word in the marketing collection.`);
  }

  return word;
}

export function resolvePricingFeatures(features: readonly PricingFeatureCopy[]): ResolvedPricingFeature[] {
  const copyById = new Map(features.map((feature) => [feature.id, feature] as const));

  return FEATURE_CELLS.map((cell) => {
    const copy = copyById.get(cell.id);

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
}

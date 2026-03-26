import type { Plan } from "@keeper.sh/data-schemas";

const DEFAULT_PLAN: Plan = "pro";

const parseProductIds = (value: string | undefined): Set<string> => {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
};

interface ProductPlanMappingConfig {
  proProductIds: string | undefined;
  unlimitedProductIds: string | undefined;
}

interface ProductPlanMapping {
  resolveProductPlan: (productId: string) => Plan;
}

const createProductPlanMapping = (config: ProductPlanMappingConfig): ProductPlanMapping => {
  const proIds = parseProductIds(config.proProductIds);
  const unlimitedIds = parseProductIds(config.unlimitedProductIds);

  const resolveProductPlan = (productId: string): Plan => {
    if (unlimitedIds.has(productId)) {
      return "unlimited";
    }

    if (proIds.has(productId)) {
      return "pro";
    }

    return DEFAULT_PLAN;
  };

  return { resolveProductPlan };
};

export { createProductPlanMapping };
export type { ProductPlanMapping, ProductPlanMappingConfig };

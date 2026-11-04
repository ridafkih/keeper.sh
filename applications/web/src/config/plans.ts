import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import { marketingCopy } from "@/lib/marketing-copy";

export interface PlanConfig {
  id: "free" | "pro";
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyProductId: string | null;
  yearlyProductId: string | null;
  features: string[];
}

const basePlans: Omit<PlanConfig, "monthlyProductId" | "yearlyProductId">[] = [
  {
    id: "free",
    ...marketingCopy.plans.free,
    monthlyPrice: 0,
    yearlyPrice: 0,
  },
  {
    id: "pro",
    ...marketingCopy.plans.pro,
    monthlyPrice: 5,
    yearlyPrice: 42,
  },
];

export const getPlans = (runtimeConfig: PublicRuntimeConfig): PlanConfig[] =>
  basePlans.map((plan): PlanConfig => {
    if (plan.id === "pro") {
      return {
        ...plan,
        monthlyProductId: runtimeConfig.polarProMonthlyProductId,
        yearlyProductId: runtimeConfig.polarProYearlyProductId,
      };
    }

    return { ...plan, monthlyProductId: null, yearlyProductId: null };
  });

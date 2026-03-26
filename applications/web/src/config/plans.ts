import type { PublicRuntimeConfig } from "@/lib/runtime-config";

export interface PlanConfig {
  id: "pro" | "unlimited";
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
    id: "pro",
    name: "Pro",
    description: "For personal use with calendar sync, aggregated feeds, and event filters.",
    monthlyPrice: 6,
    yearlyPrice: 60,
    features: [
      "Up to 2 linked accounts",
      "Up to 3 sync mappings",
      "Aggregated iCal feed",
      "iCal feed customization",
      "Event filters & exclusions",
      "Syncing every 30 minutes",
      "API access (25 calls/day)",
    ],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    description: "For power users who need fast syncs, unlimited accounts, and unlimited API access.",
    monthlyPrice: 12,
    yearlyPrice: 120,
    features: [
      "Syncing every 1 minute",
      "Unlimited linked accounts",
      "Unlimited sync mappings",
      "Aggregated iCal feed",
      "iCal feed customization",
      "Event filters & exclusions",
      "Unlimited API & MCP access",
      "Priority support",
    ],
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

    if (plan.id === "unlimited") {
      return {
        ...plan,
        monthlyProductId: runtimeConfig.polarUnlimitedMonthlyProductId,
        yearlyProductId: runtimeConfig.polarUnlimitedYearlyProductId,
      };
    }

    return { ...plan, monthlyProductId: null, yearlyProductId: null };
  });

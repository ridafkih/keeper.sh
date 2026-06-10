import type { PublicRuntimeConfig } from "@/lib/runtime-config";

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
    name: "Free",
    description: "For personal use and getting started with calendar sync.",
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      "Up to 2 linked accounts",
      "Up to 3 sync mappings",
      "Aggregated iCal feed",
      "Syncing every 30 minutes",
      "API access (25 calls/day)",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For power users who need fast syncs, advanced feed controls, and unlimited syncing.",
    monthlyPrice: 5,
    yearlyPrice: 42,
    features: [
      "Syncing every 1 minute",
      "Unlimited linked accounts",
      "Unlimited sync mappings",
      "Event filters, exclusions, and iCal feed customization",
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

    return { ...plan, monthlyProductId: null, yearlyProductId: null };
  });

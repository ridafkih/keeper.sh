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
    description: "Enough for two calendar accounts and three connections.",
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      "Up to 2 calendar accounts",
      "Up to 3 connections",
      "1 shareable calendar link",
      "Changes land every 30 minutes",
      "25 API calls a day",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "As many calendars as you want, and changes that land within a minute.",
    monthlyPrice: 5,
    yearlyPrice: 42,
    features: [
      "Changes land every minute",
      "Unlimited calendar accounts",
      "Unlimited connections",
      "Unlimited shareable links, each with its own filters",
      "Unlimited API and AI agent access",
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

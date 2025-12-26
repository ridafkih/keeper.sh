import {
  FREE_SOURCE_LIMIT,
  FREE_DESTINATION_LIMIT,
} from "@keeper.sh/premium/constants";

export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyProductId: string | null;
  yearlyProductId: string | null;
  popular?: boolean;
  features: Array<{
    name: string;
    included: boolean;
  }>;
}

export const plans: PlanConfig[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyProductId: null,
    yearlyProductId: null,
    description: "For personal use and getting started",
    features: [
      { name: `Up to ${FREE_SOURCE_LIMIT} calendar sources`, included: true },
      { name: `${FREE_DESTINATION_LIMIT} push destination`, included: true },
      { name: "Aggregate iCal feed", included: true },
      { name: "Standard syncing every 30 minutes", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 8,
    yearlyPrice: 48,
    monthlyProductId:
      process.env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID ?? null,
    yearlyProductId:
      process.env.NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID ?? null,
    description: "For power users who need more",
    popular: true,
    features: [
      { name: "Unlimited calendar sources", included: true },
      { name: "Unlimited push destinations", included: true },
      { name: "Aggregate iCal feed", included: true },
      { name: "Priority syncing every minute", included: true },
    ],
  },
];

import { FREE_DESTINATION_LIMIT, FREE_SOURCE_LIMIT } from "@keeper.sh/premium/constants";

export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyProductId: string | null;
  yearlyProductId: string | null;
  popular?: boolean;
  features: {
    name: string;
    included: boolean;
  }[];
}

export const plans: PlanConfig[] = [
  {
    description: "For personal use and getting started",
    features: [
      { included: true, name: `Up to ${FREE_SOURCE_LIMIT} calendar sources` },
      { included: true, name: `${FREE_DESTINATION_LIMIT} push destination` },
      { included: true, name: "Aggregate iCal feed" },
      { included: false, name: "Standard syncing every 30 minutes" },
    ],
    id: "free",
    monthlyPrice: 0,
    monthlyProductId: null,
    name: "Free",
    yearlyPrice: 0,
    yearlyProductId: null,
  },
  {
    description: "For power users who need more",
    features: [
      { included: true, name: "Unlimited calendar sources" },
      { included: true, name: "Unlimited push destinations" },
      { included: true, name: "Aggregate iCal feed" },
      { included: true, name: "Priority syncing every minute" },
    ],
    id: "pro",
    monthlyPrice: 5,
    monthlyProductId: process.env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID ?? null,
    name: "Pro",
    popular: true,
    yearlyPrice: 42,
    yearlyProductId: process.env.NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID ?? null,
  },
];

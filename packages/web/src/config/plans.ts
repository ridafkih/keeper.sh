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
      { name: "Up to 3 calendar sources", included: true },
      { name: "Aggregate iCal feed", included: true },
      { name: "Push to external calendars", included: true },
      { name: "Email support", included: false },
      { name: "Priority sync (every 5 min)", included: false },
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
      { name: "Aggregate iCal feed", included: true },
      { name: "Push to external calendars", included: true },
      { name: "Priority email support", included: true },
      { name: "Priority sync (every 5 min)", included: true },
    ],
  },
];

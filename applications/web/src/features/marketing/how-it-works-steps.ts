import { marketingCopy } from "@/lib/marketing-copy";

export type HowItWorksStep = {
  title: string;
  body: string;
  note?: string;
};

// Shared by the homepage and /features so the two never drift apart on what
// setting a connection up actually involves. The wording lives in the seo
// submodule under marketing/how-it-works.json.
export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = marketingCopy.howItWorks.steps;

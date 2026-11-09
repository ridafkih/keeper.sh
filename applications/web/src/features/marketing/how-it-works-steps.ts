import { resolveHowItWorksSteps } from "./how-it-works-layout";
import { marketingCopy } from "@/lib/marketing-copy";

// Shared by the homepage and /features so the two never drift apart on what
// setting a connection up actually involves. The wording lives in the seo
// submodule under marketing/how-it-works.json.
export const HOW_IT_WORKS_STEPS = resolveHowItWorksSteps(marketingCopy.howItWorks.steps);

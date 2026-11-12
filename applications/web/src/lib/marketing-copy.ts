// @ts-expect-error - virtual module provided by plugins/marketing.ts
import { marketingCopy as processedCopy } from "virtual:marketing-copy";
import type { MarketingCopy } from "./marketing-content";

/**
 * The marketing pages' words, read from the `seo` submodule under `marketing`,
 * one file per surface. The pages keep their own layout, icons, links and
 * derived logic; only the copy lives here. `plugins/marketing.ts` reads and
 * validates the files, and this module only types what it produces.
 */
export const marketingCopy: MarketingCopy = processedCopy;

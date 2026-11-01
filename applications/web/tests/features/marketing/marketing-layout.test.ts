import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  FEATURE_CELLS,
  PRICING_PLAN_IDS,
  resolvePricingFeatures,
} from "../../../src/features/marketing/pricing-layout";
import {
  HOW_IT_WORKS_STEP_IDS,
  resolveHowItWorksSteps,
} from "../../../src/features/marketing/how-it-works-layout";
import { fallbackMarketingCopy, processMarketingDirectory } from "../../../src/lib/marketing-content";

describe("default marketing copy", () => {
  const emptyDirectory = mkdtempSync(join(tmpdir(), "keeper-marketing-"));

  afterAll(() => rmSync(emptyDirectory, { recursive: true, force: true }));

  it("is used when the seo submodule is absent", () => {
    expect(processMarketingDirectory(emptyDirectory)).toBe(fallbackMarketingCopy);
    expect(processMarketingDirectory(join(emptyDirectory, "missing"))).toBe(fallbackMarketingCopy);
  });

  it("covers every pricing row", () => {
    const features = resolvePricingFeatures(fallbackMarketingCopy.pricingPlans.features);

    expect(features).toHaveLength(FEATURE_CELLS.length);
  });

  it("covers every how-it-works step", () => {
    const steps = resolveHowItWorksSteps(fallbackMarketingCopy.howItWorks.steps);

    expect(Object.keys(steps)).toEqual([...HOW_IT_WORKS_STEP_IDS]);
  });

  it("covers every plan", () => {
    expect(fallbackMarketingCopy.pricingPlans.plans.map((plan) => plan.id)).toEqual([...PRICING_PLAN_IDS]);
  });
});

describe("resolvePricingFeatures", () => {
  it("fails loudly when a row has no copy", () => {
    const features = fallbackMarketingCopy.pricingPlans.features.slice(1);

    expect(() => resolvePricingFeatures(features)).toThrow(
      `Pricing feature "${FEATURE_CELLS[0].id}" has no copy in the marketing collection.`,
    );
  });

  it("fails loudly when a worded cell has no word", () => {
    const features = fallbackMarketingCopy.pricingPlans.features.map((feature) => ({ ...feature, free: undefined }));

    expect(() => resolvePricingFeatures(features)).toThrow(/is missing its free word/);
  });
});

describe("resolveHowItWorksSteps", () => {
  it("fails loudly when a step has no copy", () => {
    const steps = fallbackMarketingCopy.howItWorks.steps.slice(1);

    expect(() => resolveHowItWorksSteps(steps)).toThrow(
      `How-it-works step "${HOW_IT_WORKS_STEP_IDS[0]}" has no copy in the marketing collection.`,
    );
  });
});

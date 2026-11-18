import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { MarketingPricingPlanCard } from "../../../../src/features/marketing/components/marketing-pricing-section";
import {
  PRICING_FEATURES,
  PRICING_PLANS,
  pricingPlanHighlights,
} from "../../../../src/features/marketing/pricing-plans";
import { SEO_CONTENT_ROOT } from "../../../../src/lib/content-paths";
import { marketingContentPresent } from "../../../../src/lib/marketing-content";

const COPY_PRESENT = marketingContentPresent(
  join(import.meta.dirname, "../../../..", SEO_CONTENT_ROOT, "marketing"),
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
}));

function renderPlanCard(planId: "free" | "pro") {
  const plan = PRICING_PLANS.find((candidate) => candidate.id === planId)!;

  return renderToStaticMarkup(
    <MarketingPricingPlanCard
      tone={plan.tone}
      name={plan.name}
      price={plan.price}
      period={plan.period}
      description={plan.description}
      ctaLabel={plan.ctaLabel}
      features={pricingPlanHighlights(plan.id)}
    />,
  );
}

describe("pricingPlanHighlights", () => {
  it("returns only the rows where the plans differ", () => {
    for (const planId of ["free", "pro"] as const) {
      expect(pricingPlanHighlights(planId)).toEqual(
        PRICING_FEATURES.flatMap((feature) => feature.highlight?.[planId] ?? []),
      );
    }
  });

  it("skips rows the plans share, so the bullets only carry differences", () => {
    const shared = PRICING_FEATURES.filter((feature) => feature.free === feature.pro);

    for (const feature of shared) {
      expect(pricingPlanHighlights("free")).not.toContain(feature.label);
      expect(pricingPlanHighlights("pro")).not.toContain(feature.label);
    }
  });
});

describe("MarketingPricingPlanCard", () => {
  it.skipIf(!COPY_PRESENT)("lists the plan's differentiating bullets for narrow viewports only", () => {
    const { document } = parseHTML(`<html><body>${renderPlanCard("free")}</body></html>`);
    const list = document.querySelector("ul");

    expect(list?.className).toContain("md:hidden");
    expect([...document.querySelectorAll("li")].map((item) => item.textContent)).toEqual(
      pricingPlanHighlights("free"),
    );
  });

  it("renders no list when the plan has no differentiating bullets", () => {
    const { document } = parseHTML(
      `<html><body>${renderToStaticMarkup(
        <MarketingPricingPlanCard name="Free" price="$0" period="/mo" description="" ctaLabel="Start" />,
      )}</body></html>`,
    );

    expect(document.querySelector("ul")).toBeNull();
  });

  it.skipIf(!COPY_PRESENT)("keeps the plan name as the only heading in the card", () => {
    const { document } = parseHTML(`<html><body>${renderPlanCard("pro")}</body></html>`);
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];

    expect(headings.map((heading) => heading.tagName.toLowerCase())).toEqual(["h3"]);
    expect(headings[0]?.textContent).toBe("Pro");
  });
});

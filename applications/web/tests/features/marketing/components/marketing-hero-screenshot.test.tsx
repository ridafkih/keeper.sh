import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingHeroScreenshot } from "../../../../src/features/marketing/components/marketing-hero-screenshot";

describe("MarketingHeroScreenshot", () => {
  it("describes what the screenshot shows", () => {
    const markup = renderToStaticMarkup(<MarketingHeroScreenshot />);

    expect(markup).toContain('alt="The Keeper.sh dashboard');
  });

  it("declares intrinsic dimensions so the hero reserves space before the image loads", () => {
    const markup = renderToStaticMarkup(<MarketingHeroScreenshot />);

    expect(markup).toContain('width="832"');
    expect(markup).toContain('height="868"');
  });

  it("offers a dark variant for viewers in a dark colour scheme", () => {
    const markup = renderToStaticMarkup(<MarketingHeroScreenshot />);

    expect(markup).toContain('srcSet="/product/dashboard-dark.png"');
    expect(markup).toContain('media="(prefers-color-scheme: dark)"');
    expect(markup).toContain('src="/product/dashboard-light.png"');
  });
});

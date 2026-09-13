import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailOptions } from "../../../../src/features/setup/components/detail-options";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

vi.mock("../../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

describe("DetailOptions", () => {
  it("locks the Pro titles behind an upgrade hint on the free plan", () => {
    const markup = renderToStaticMarkup(
      <DetailOptions selected="calendar_name" locked onSelect={() => null} />,
    );

    expect(markup).toContain("Custom event titles are a Pro feature.");
    expect(markup).toContain("Upgrade to Pro");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("offers every title once the plan allows it", () => {
    const markup = renderToStaticMarkup(
      <DetailOptions selected="busy" locked={false} onSelect={() => null} />,
    );

    expect(markup).not.toContain("Upgrade to Pro");
    expect(markup).not.toContain("disabled");
  });
});

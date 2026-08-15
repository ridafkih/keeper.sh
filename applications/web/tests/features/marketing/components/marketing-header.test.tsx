import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.ComponentPropsWithoutRef<"a"> & { to?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("lucide-react/dist/esm/icons/menu", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

vi.mock("lucide-react/dist/esm/icons/x", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

let MarketingHeaderMenu: typeof import("../../../../src/features/marketing/components/marketing-header").MarketingHeaderMenu;
let MarketingHeaderNav: typeof import("../../../../src/features/marketing/components/marketing-header").MarketingHeaderNav;

beforeAll(async () => {
  ({ MarketingHeaderMenu, MarketingHeaderNav } = await import(
    "../../../../src/features/marketing/components/marketing-header"
  ));
});

describe("MarketingHeaderNav", () => {
  it("renders the primary destinations as links", () => {
    const markup = renderToStaticMarkup(<MarketingHeaderNav />);

    expect(markup).toContain('aria-label="Primary"');
    expect(markup).toContain('href="/features"');
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain('href="/changelog"');
  });
});

describe("MarketingHeaderMenu", () => {
  it("gives the collapsed toggle an accessible name and closed state", () => {
    const markup = renderToStaticMarkup(<MarketingHeaderMenu />);

    expect(markup).toContain('aria-label="Open navigation menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="marketing-header-menu"');
  });
});

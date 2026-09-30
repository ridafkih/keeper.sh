import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupCard } from "../../../../src/features/setup/components/setup-card";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SetupCard", () => {
  it("lists the three steps for a new user", () => {
    const markup = renderToStaticMarkup(<SetupCard sourceCount={1} accountCount={1} syncCount={0} />);

    expect(markup).toContain("Get Set Up");
    expect(markup).toContain("Connect a Calendar");
    expect(markup).toContain("Connect a Second Calendar");
    expect(markup).toContain("Choose What Syncs Where");
    expect(markup.match(/href="\/dashboard\/setup"/g)).toHaveLength(3);
  });

  it("disappears once the first mapping exists", () => {
    expect(renderToStaticMarkup(<SetupCard sourceCount={2} accountCount={2} syncCount={1} />)).toBe("");
  });
});

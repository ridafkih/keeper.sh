import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupCard } from "../../../../src/features/setup/components/setup-card";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SetupCard", () => {
  it("lists the three steps for a new user, saying which are done", () => {
    const markup = renderToStaticMarkup(<SetupCard sourceCount={1} pairable={false} syncCount={0} usesFeeds={false} />);

    expect(markup).toContain("Get Set Up");
    expect(markup).toContain("Connect a Calendar");
    expect(markup).toContain("Connect a Second Calendar");
    expect(markup).toContain("Choose What Syncs Where");
    expect(markup.match(/href="\/dashboard\/setup"/g)).toHaveLength(3);
    expect(markup.match(/, done</g)).toHaveLength(1);
    expect(markup.match(/, not done yet</g)).toHaveLength(2);
  });

  it("disappears once the first sync exists", () => {
    expect(renderToStaticMarkup(<SetupCard sourceCount={2} pairable syncCount={1} usesFeeds={false} />)).toBe("");
  });
});

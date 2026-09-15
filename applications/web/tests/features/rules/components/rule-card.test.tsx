import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleCard } from "../../../../src/features/rules/components/rule-card";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

vi.mock("swr", () => ({ preload: () => Promise.resolve(undefined) }));

describe("RuleCard", () => {
  it("links to the editor and summarises the rule and its usage", () => {
    const markup = renderToStaticMarkup(
      <RuleCard
        rule={{
          actions: [{ kind: "rename", template: "OOO" }],
          assignmentCount: 2,
          conditions: [{ kind: "title_contains", value: "Standup" }],
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "rule-1",
          isDefault: false,
          name: "Hide standups",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );
    expect(markup).toContain('href="/dashboard/rules/rule-1"');
    expect(markup).toContain("Hide standups");
    expect(markup).toContain("Title contains &quot;Standup&quot; · renamed &quot;OOO&quot; · 2 pairs");
  });
});

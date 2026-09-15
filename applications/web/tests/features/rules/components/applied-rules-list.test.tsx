import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppliedRulesList } from "../../../../src/features/rules/components/applied-rules-list";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params }: { children?: React.ReactNode; to?: string; params?: Record<string, string> }) => (
    <a href={`${to}:${params?.ruleId ?? ""}`}>{children}</a>
  ),
}));

vi.mock("swr", () => ({ preload: () => Promise.resolve(undefined) }));

const rule = (id: string, name: string) => ({
  actions: [{ kind: "skip" as const }],
  conditions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isDefault: false,
  name,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("AppliedRulesList", () => {
  it("explains that an empty list copies nothing", () => {
    const markup = renderToStaticMarkup(<AppliedRulesList rules={[]} onMove={() => null} onRemove={() => null} />);
    expect(markup).toContain("No rules applied");
  });

  it("offers move and remove controls with the ends disabled", () => {
    const markup = renderToStaticMarkup(
      <AppliedRulesList rules={[rule("a", "Skip standups"), rule("b", "Busy only")]} onMove={() => null} onRemove={() => null} />,
    );
    expect(markup).toMatch(/aria-label="Move Skip standups up"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="Move Skip standups down"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Move Busy only down"[^>]*disabled=""/);
    expect(markup).toContain('aria-label="Remove Busy only"');
    expect(markup).toContain("Every event · not copied");
    expect(markup).toContain('href="/dashboard/rules/$ruleId:a"');
  });
});

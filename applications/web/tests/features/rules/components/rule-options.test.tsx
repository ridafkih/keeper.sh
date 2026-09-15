import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleOptions } from "../../../../src/features/rules/components/rule-options";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

vi.mock("../../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const rules = [
  { actions: [], conditions: [], createdAt: "", id: "busy", isDefault: true, name: "Busy only", updatedAt: "" },
  { actions: [{ kind: "skip" as const }], conditions: [], createdAt: "", id: "skip", isDefault: false, name: "Skip", updatedAt: "" },
];

describe("RuleOptions", () => {
  it("marks the selected rule and gates creation behind an upgrade hint", () => {
    const markup = renderToStaticMarkup(
      <RuleOptions rules={rules} selectedId="skip" canCreate={false} onSelect={() => null} onCreate={() => null} />,
    );
    expect(markup).toContain("Busy only");
    expect(markup).toContain("Free plans include one rule.");
    expect(markup).toContain("Upgrade to Pro");
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
    expect(markup.indexOf("lucide-check")).toBeGreaterThan(markup.indexOf("Skip"));
  });

  it("lets a Pro plan start a new rule", () => {
    const markup = renderToStaticMarkup(
      <RuleOptions rules={rules} selectedId={null} canCreate onSelect={() => null} onCreate={() => null} />,
    );
    expect(markup).not.toContain("Upgrade to Pro");
    expect(markup).not.toContain("disabled");
    expect(markup).toContain("New Rule…");
  });
});

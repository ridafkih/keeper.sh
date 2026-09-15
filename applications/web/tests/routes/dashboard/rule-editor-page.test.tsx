import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/rules/$ruleId";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData } = vi.hoisted(() => ({
  captured: { component: null } as CapturedRoute,
  swrData: new Map<string, unknown>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return { useParams: () => ({ ruleId: "rule-ooo" }) };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useCanGoBack: () => false,
  useNavigate: () => () => null,
  useRouter: () => ({ history: { back: () => null } }),
}));

vi.mock("swr", () => {
  const useSWR = (key: string | string[]) => ({
    data: swrData.get(Array.isArray(key) ? key.join("|") : key),
    error: undefined,
    isLoading: false,
    mutate: () => Promise.resolve(undefined),
  });
  return {
    default: useSWR,
    preload: () => Promise.resolve(undefined),
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("../../../src/hooks/use-popover-overlay", () => ({
  useSetPopoverOverlay: () => () => null,
}));

vi.mock("../../../src/hooks/use-entitlements", () => ({
  useEntitlements: () => ({ data: { canUseEventFilters: false, rules: { current: 2, limit: null } } }),
  useMutateEntitlements: () => ({ revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

vi.mock("../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const renderPage = (isDefault: boolean): string => {
  swrData.clear();
  swrData.set("/api/rules/rule-ooo", {
    actions: [{ kind: "rename", template: "OOO" }, { kind: "drop_description" }],
    assignments: [{ destinationId: "personal", sourceId: "work" }],
    conditions: [{ kind: "title_contains", value: "Standup" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "rule-ooo",
    isDefault,
    name: "Hide standups",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  swrData.set("/api/sources", [
    makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
    makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
    makeSource("family", "outlook-account", ["pull", "push"], { name: "Family", provider: "outlook" }),
  ]);
  swrData.set("/api/sources/details|work|personal|family", {
    family: { destinationIds: [], id: "family" },
    personal: { destinationIds: [], id: "personal" },
    work: { destinationIds: ["personal", "family"], id: "work" },
  });
  const Page = captured.component;
  if (!Page) throw new Error("Rule editor route did not register a component");
  return renderToStaticMarkup(<Page />);
};

describe("rule editor page", () => {
  it("shows the rule's rows, its pairs, and gates content edits on the free plan", () => {
    const markup = renderPage(false);

    expect(markup).toContain("Hide standups");
    expect(markup).toContain("Title contains &quot;Standup&quot; · renamed &quot;OOO&quot;, no description");
    expect(markup).toContain("Title Contains");
    expect(markup).toContain("Rename To");
    expect(markup).toContain("Drop the Description");
    expect(markup).toContain("Custom rules are a Pro feature.");
    expect(markup).toContain('href="/dashboard/rules/pairs/work/personal"');
    expect(markup).toContain('aria-label="Remove from Work → Personal"');
    expect(markup).toContain("Add Calendars");
    expect(markup).toContain("Delete Rule");
  });

  it("keeps the default rule from being deleted", () => {
    const markup = renderPage(true);

    expect(markup).not.toContain("Delete Rule");
    expect(markup).toContain("Your default rule cannot be deleted.");
  });
});

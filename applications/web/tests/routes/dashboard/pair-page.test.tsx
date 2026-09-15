import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/rules/pairs.$sourceId.$destinationId";

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
    return { useParams: () => ({ destinationId: "personal", sourceId: "work" }) };
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
  canAddMore: () => true,
  useEntitlements: () => ({ data: { canUseEventFilters: true, rules: { current: 2, limit: null } } }),
  useMutateEntitlements: () => ({ revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

const rule = (id: string, name: string, isDefault: boolean) => ({
  actions: [{ kind: "skip" }],
  assignmentCount: 1,
  conditions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isDefault,
  name,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const renderPage = (ruleIds: string[]): string => {
  swrData.clear();
  swrData.set("/api/rules", [rule("rule-busy", "Busy only", true), rule("rule-ooo", "Hide standups", false)]);
  swrData.set("/api/sources/work/destinations/personal/rules", { ruleIds });
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
  if (!Page) throw new Error("Pair route did not register a component");
  return renderToStaticMarkup(<Page />);
};

describe("pair page", () => {
  it("names the pair, lists its rules in order, and links out", () => {
    const markup = renderPage(["rule-ooo", "rule-busy"]);

    expect(markup).toMatch(/<h1[^>]*>Work<\/h1>[\s\S]{0,700}<h1[^>]*>Personal<\/h1>/);
    expect(markup).toContain("Applied Rules");
    expect(markup.indexOf("Hide standups")).toBeLessThan(markup.indexOf("Busy only"));
    expect(markup).toContain('aria-label="Move Busy only up"');
    expect(markup).toContain("Apply a Rule");
    expect(markup).toContain('href="/dashboard/rules/pairs/work/family"');
    expect(markup).not.toContain('href="/dashboard/rules/pairs/work/personal"');
    expect(markup).toContain('href="/dashboard/accounts/google-account/work"');
    expect(markup).toContain('href="/dashboard/accounts/outlook-account/personal"');
  });

  it("warns when a pair has no rules left", () => {
    expect(renderPage([])).toContain("No rules applied — nothing is copied yet");
  });
});

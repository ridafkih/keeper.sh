import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/rules/index";

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
    return { useLoaderData: () => ({ rules: null }) };
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

vi.mock("../../../src/hooks/use-entitlements", () => ({
  canAddMore: (limit: { current: number; limit: number | null } | undefined) => !limit || limit.limit === null || limit.current < limit.limit,
  useEntitlements: () => ({ data: { canUseEventFilters: false, rules: { current: 1, limit: 1 } } }),
  useMutateEntitlements: () => ({ revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

vi.mock("../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const busyOnly = {
  actions: [{ kind: "rename", template: "{{calendar_name}}" }, { kind: "drop_description" }, { kind: "drop_location" }],
  assignmentCount: 1,
  conditions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "rule-busy",
  isDefault: true,
  name: "Busy only",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const detail = (id: string, destinationIds: string[]) => ({ destinationIds, id });

const renderPage = (): string => {
  swrData.clear();
  swrData.set("/api/rules", [busyOnly]);
  swrData.set("/api/sources", [
    makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
    makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
  ]);
  swrData.set("/api/sources/details|work|personal", { personal: detail("personal", []), work: detail("work", ["personal"]) });
  const Page = captured.component;
  if (!Page) throw new Error("Rules route did not register a component");
  return renderToStaticMarkup(<Page />);
};

describe("rules page", () => {
  it("lists rules, pairs, and the free plan's rule limit", () => {
    const markup = renderPage();

    expect(markup).toContain("Busy only");
    expect(markup).toContain('href="/dashboard/rules/rule-busy"');
    expect(markup).toContain("1 pair. Tap one to choose which rules it applies.");
    expect(markup).toContain('href="/dashboard/rules/pairs/work/personal"');
    expect(markup).toMatch(/Work[\s\S]{0,900}Personal/);
    expect(markup).toContain("Free plans include one rule.");
    expect(markup).toContain('href="/dashboard/setup"');
  });
});

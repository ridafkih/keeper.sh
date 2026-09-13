import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupDraft } from "../../../src/features/setup/setup-draft";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/setup";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData, draftState, omitMotionProps } = vi.hoisted(() => {
  const omitMotionProps = <T extends Record<string, unknown>>(props: T) => {
    const domProps = { ...props };
    delete domProps.animate;
    delete domProps.exit;
    delete domProps.initial;
    delete domProps.transition;
    return domProps;
  };
  return {
    captured: { component: null } as CapturedRoute,
    draftState: { draft: null as SetupDraft | null },
    omitMotionProps,
    swrData: new Map<string, unknown>(),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return {
      useLoaderData: () => ({ sources: null }),
      useSearch: () => ({}),
    };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useCanGoBack: () => false,
  useNavigate: () => () => null,
  useRouter: () => ({ history: { back: () => null } }),
}));

vi.mock("swr", () => {
  const useSWR = (key: string) => ({
    data: swrData.get(key),
    error: undefined,
    isLoading: false,
    mutate: () => Promise.resolve(undefined),
  });
  return {
    default: useSWR,
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("motion/react-m", () => ({
  div: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => (
    <div {...omitMotionProps(props)}>{children}</div>
  ),
}));

vi.mock("../../../src/lib/motion-features", () => ({
  loadMotionFeatures: async () => ({}),
}));

vi.mock("../../../src/hooks/use-entitlements", () => ({
  canAddMore: () => true,
  useEntitlements: () => ({ data: { accounts: { current: 1, limit: 2 }, canUseEventFilters: false, mappings: { current: 0, limit: 3 } } }),
  useMutateEntitlements: () => ({ adjustMappingCount: () => null, revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

vi.mock("../../../src/hooks/use-popover-overlay", () => ({
  useSetPopoverOverlay: () => () => null,
}));

vi.mock("../../../src/features/setup/use-setup-draft", () => ({
  useSetupDraft: () => ({ clear: () => null, draft: draftState.draft, update: () => null }),
}));

vi.mock("../../../src/features/setup/use-login-import", () => ({
  useLoginImport: () => null,
}));

vi.mock("../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const sources = [
  makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
  makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
];

const renderPage = (draft: SetupDraft): string => {
  swrData.clear();
  swrData.set("/api/sources", sources);
  draftState.draft = draft;
  const Page = captured.component;
  if (!Page) throw new Error("Setup route did not register a component");
  return renderToStaticMarkup(<Page />);
};

const emptyDraft: SetupDraft = {
  pending: null,
  rules: [{ detail: "calendar_name", fromId: null, id: "rule-1", toId: null }],
  version: 1,
};

const completeDraft: SetupDraft = {
  pending: null,
  rules: [{ detail: "calendar_name", fromId: "work", id: "rule-1", toId: "personal" }],
  version: 1,
};

const START_DISABLED = /<button[^>]* disabled=""[^>]*><span[^>]*>Start Syncing/;

describe("setup page", () => {
  it("renders an empty sentence with both blanks and no way to start yet", () => {
    const markup = renderPage(emptyDraft);

    expect(markup).toContain("Copy events from");
    expect(markup).toContain("a calendar");
    expect(markup).toContain("another calendar");
    expect(markup).toContain("their calendar&#x27;s name");
    expect(markup).toMatch(START_DISABLED);
  });

  it("fills the blanks from the draft and lets a complete rule start", () => {
    const markup = renderPage(completeDraft);

    expect(markup).toContain("Work");
    expect(markup).toContain("Personal");
    expect(markup).toContain("1 of 3 syncs on the free plan.");
    expect(markup).not.toMatch(START_DISABLED);
  });
});

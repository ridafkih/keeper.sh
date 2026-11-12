import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SyncSummary } from "@keeper.sh/data-schemas";
import type { LoginImportStatus } from "../../../src/features/setup/use-login-import";
import type { CalendarSource } from "../../../src/types/api";
import { createEmptyDraft, type SetupDraft } from "../../../src/features/setup/setup-draft";
import { buildFirstConnectDraft, createSyncDraft } from "../../../src/features/syncs/sync-draft";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/setup";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData, draftState, omitMotionProps, plan, importState } = vi.hoisted(() => {
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
    importState: { status: "idle" as LoginImportStatus },
    omitMotionProps,
    plan: { atLimit: false },
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
  MotionConfig: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false,
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
  USAGE_CACHE_KEY: "/api/entitlements",
  canAddMore: () => !plan.atLimit,
  useEntitlements: () => ({ data: { accounts: { current: 1, limit: 2 }, canUseEventFilters: false, syncs: { current: 0, limit: 1 } } }),
  useMutateEntitlements: () => ({ revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

vi.mock("../../../src/hooks/use-popover-overlay", () => ({
  useSetPopoverOverlay: () => () => null,
}));

vi.mock("../../../src/features/setup/use-setup-draft", () => ({
  useSetupDraft: () => ({ clear: () => null, draft: draftState.draft, update: () => null }),
}));

vi.mock("../../../src/features/setup/use-login-import", () => ({
  useLoginImport: () => ({ retry: () => null, status: importState.status }),
}));

vi.mock("../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const sources = [
  makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
  makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
  makeSource("family", "outlook-account", ["pull", "push"], { name: "Family", provider: "outlook" }),
];

const existingSync: SyncSummary = {
  ...createSyncDraft(null, { destinationCalendarIds: ["personal"], name: "Desk", sourceCalendarIds: ["work"] }),
  copiedCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  id: "sync-1",
  lastSyncedAt: null,
  pairCount: 1,
  skippedCount: 0,
  state: "ok",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

interface RenderOptions {
  syncs?: SyncSummary[];
  calendars?: CalendarSource[];
  atLimit?: boolean;
  importStatus?: LoginImportStatus;
}

const renderPage = (draft: SetupDraft, { syncs = [], calendars = sources, atLimit = false, importStatus = "idle" }: RenderOptions = {}): string => {
  swrData.clear();
  swrData.set("/api/sources", calendars);
  swrData.set("/api/syncs", syncs);
  plan.atLimit = atLimit;
  importState.status = importStatus;
  draftState.draft = draft;
  const Page = captured.component;
  if (!Page) throw new Error("Setup route did not register a component");
  return renderToStaticMarkup(<Page />);
};

const START_DISABLED = /<button[^>]* disabled=""[^>]*><span[^>]*>Start Syncing/;

describe("setup page", () => {
  it("renders an empty sentence with both blanks and no way to start yet", () => {
    const markup = renderPage(createEmptyDraft());

    expect(markup).toContain("Tell Keeper What to Do");
    expect(markup).toContain("Copy events from");
    expect(markup).toContain("a calendar");
    expect(markup).toContain("another calendar");
    expect(markup).toContain("Share As");
    expect(markup).toContain("Never Copy");
    expect(markup).toMatch(START_DISABLED);
  });

  it("introduces the first-connect Block My Time draft and lets it start", () => {
    const sync = buildFirstConnectDraft(sources, false);
    if (!sync) throw new Error("expected a first-connect draft");
    const markup = renderPage({ ...createEmptyDraft(), firstConnect: true, sync });

    expect(markup).toContain("Your First Sync Is Ready");
    expect(markup).toContain("in step, each blocking the others.");
    expect(markup).toContain("Work");
    expect(markup).toContain("Personal");
    expect(markup).not.toMatch(START_DISABLED);
  });

  it("offers the calendar just connected to the sync the user already has", () => {
    const markup = renderPage({ ...createEmptyDraft(), connectedAccountId: "outlook-account" }, { syncs: [existingSync] });

    expect(markup).toContain("Add to a Sync You Have");
    expect(markup).toContain("Add Family to Desk");
    expect(markup).toContain('href="/dashboard/syncs/sync-1"');
  });

  it("points a user at the sync limit to the sync they have, not only a disabled Start", () => {
    const markup = renderPage(createEmptyDraft(), { atLimit: true, syncs: [existingSync] });

    expect(markup).toContain("Open Desk");
    expect(markup).toContain("Free plans include one sync");
    expect(markup).toMatch(START_DISABLED);
  });

  it("says when the calendars from a social sign-in couldn't be brought in", () => {
    expect(renderPage(createEmptyDraft(), { calendars: [], importStatus: "importing" })).toContain("Bringing in the calendars from your sign-in");
    expect(renderPage(createEmptyDraft(), { calendars: [], importStatus: "failed" })).toContain("Try again");
  });
});

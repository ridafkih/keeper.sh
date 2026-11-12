import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { mountDom, type MountedDom } from "../../../helpers/mount-dom";
import type * as Analytics from "../../../../src/lib/analytics";
import { makeSource } from "../../setup/fixtures";
import { fetcher } from "../../../../src/lib/fetcher";
import type { SyncActivityPage, SyncDetail } from "@keeper.sh/data-schemas";
import { DEFAULT_SYNC_SETTINGS } from "@keeper.sh/data-schemas";
import { SyncActivity } from "../../../../src/features/syncs/components/sync-activity";
import { calendarIssues } from "../../../../src/features/syncs/sync-activity";

interface BlockerArgs {
  current: { pathname: string };
  next: { pathname: string };
}

const { router, omitMotionProps } = vi.hoisted(() => ({
  omitMotionProps: <T extends Record<string, unknown>>(props: T) => {
    const domProps = { ...props };
    delete domProps.animate;
    delete domProps.exit;
    delete domProps.initial;
    delete domProps.transition;
    return domProps;
  },
  router: {
    blocked: false,
    navigate: vi.fn(),
    search: {} as Record<string, unknown>,
    shouldBlock: null as ((args: BlockerArgs) => boolean) | null,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useBlocker: ({ shouldBlockFn }: { shouldBlockFn: (args: BlockerArgs) => boolean }) => {
    router.shouldBlock = shouldBlockFn;
    return { proceed: () => null, reset: () => null, status: router.blocked ? "blocked" : "idle" };
  },
  useCanGoBack: () => false,
  useNavigate: () => router.navigate,
  useRouter: () => ({ history: { back: () => null } }),
  useSearch: () => router.search,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
  MotionConfig: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false,
}));

vi.mock("motion/react-m", () => ({
  div: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => <div {...omitMotionProps(props)}>{children}</div>,
  li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => <li {...omitMotionProps(props)}>{children}</li>,
  span: ({ children, ...props }: React.ComponentPropsWithoutRef<"span">) => <span {...omitMotionProps(props)}>{children}</span>,
}));

vi.mock("../../../../src/lib/motion-features", () => ({ loadMotionFeatures: async () => ({}) }));
vi.mock("../../../../src/hooks/use-popover-overlay", () => ({ useSetPopoverOverlay: () => () => null }));
vi.mock("../../../../src/config/commercial", () => ({ getCommercialMode: () => true }));
vi.mock("../../../../src/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof Analytics>()),
  track: () => null,
}));
vi.mock("../../../../src/hooks/use-entitlements", () => ({
  USAGE_CACHE_KEY: "/api/entitlements",
  canAddMore: () => true,
  useEntitlements: () => ({
    data: { accounts: { current: 2, limit: null }, canUseEventFilters: false, plan: "free", syncCalendars: { limit: 3 }, syncs: { current: 0, limit: 1 } },
    isLoading: false,
  }),
}));

const calendars = [
  makeSource("work", "google", ["pull", "push"], { name: "Work" }),
  makeSource("personal", "icloud", ["pull", "push"], { name: "Personal" }),
  makeSource("family", "outlook", ["pull", "push"], { name: "Family" }),
];
const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));

const sync = (overrides: Partial<SyncDetail> = {}): SyncDetail => ({
  ...DEFAULT_SYNC_SETTINGS,
  copiedCount: 0,
  createdAt: "2026-10-01T09:00:00.000Z",
  destinationCalendarIds: ["personal", "family"],
  destinations: [
    { calendarId: "personal", copiedCount: 0, lastSyncedAt: null, problem: null, skippedCount: 0 },
    { calendarId: "family", copiedCount: 0, lastSyncedAt: null, problem: null, skippedCount: 0 },
  ],
  id: "s1",
  lastSyncedAt: null,
  memberCalendarIds: [],
  mode: "one_way",
  name: "Work out",
  pairCount: 2,
  paused: false,
  skippedCount: 0,
  sourceCalendarIds: ["work"],
  sources: [{ calendarId: "work", problem: null }],
  state: "ok",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...overrides,
});

const PAGE: SyncActivityPage = {
  entries: [],
  nextCursor: null,
  summary: { added: 4, removed: 0, skipped: 7, skippedBy: [{ count: 7, name: "All-day events", ruleId: "skip:all_day" }] },
};

let mounted: MountedDom | null = null;
let activity: () => Promise<Response>;
let requests: { url: string; method: string; body: unknown }[] = [];

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });

const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  requests.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method: init?.method ?? "GET", url });
  if (url.startsWith("/api/syncs/s1/activity")) return activity();
  return json(200, {});
};

const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round++) {
    await mounted?.flush();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

const mount = async (detail: SyncDetail) => {
  mounted = mountDom(
    <SWRConfig value={{ dedupingInterval: 0, fetcher, provider: () => new Map(), revalidateOnFocus: false, shouldRetryOnError: false }}>
      <SyncActivity sync={detail} calendars={calendars} />
    </SWRConfig>,
  );
  await settle();
};

const pageText = (): string => mounted?.document.body.textContent ?? "";

beforeEach(() => {
  requests = [];
  activity = async () => json(200, PAGE);
  vi.stubGlobal("fetch", vi.fn(handle));
  vi.stubGlobal("getComputedStyle", () => ({ overflowY: "visible", position: "static" }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => clearTimeout(frame));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("calendarIssues", () => {
  it("offers Reconnect only for lost authorization, and lists a both-ways calendar once", () => {
    const issues = calendarIssues({
      destinations: [
        { calendarId: "personal", copiedCount: 0, lastSyncedAt: null, problem: "failing", skippedCount: 0 },
        { calendarId: "work", copiedCount: 0, lastSyncedAt: null, problem: "reauth", skippedCount: 0 },
      ],
      sources: [{ calendarId: "work", problem: "reauth" }, { calendarId: "family", problem: "disabled" }],
    }, calendarsById);

    expect(issues).toEqual([
      { calendarId: "work", name: "Work", problem: "reauth", to: "/dashboard/accounts/google/reconnect" },
      { calendarId: "family", name: "Family", problem: "disabled", to: null },
      { calendarId: "personal", name: "Personal", problem: "failing", to: "/dashboard/accounts/icloud/personal" },
    ]);
  });
});

describe("SyncActivity", () => {
  it("shows a spinner while the first page loads", async () => {
    activity = () => new Promise(() => { /* Never answers, so the first page stays loading. */ });
    await mount(sync());
    expect(mounted?.document.querySelector("[aria-label='Loading activity']")).not.toBeNull();
    expect(pageText()).not.toContain("Changes and sync runs show up here");
  });

  it("says when the activity can't load and offers a retry", async () => {
    activity = async () => json(500, { error: "down" });
    await mount(sync());
    expect(pageText()).toContain("Couldn't load this sync's activity.");
    expect(pageText()).toContain("Retry");
  });

  it("reads the summary as the API sent it", async () => {
    await mount(sync({ skippedCount: 99 }));
    expect(pageText()).toContain("Skipping 7 events, mostly all-day events.");
    expect(pageText()).toContain("7 events");
    expect(pageText()).not.toContain("99");
  });

  it("says a paused sync is waiting instead of reading out its old skips", async () => {
    await mount(sync({ paused: true, state: "paused" }));
    expect(pageText()).toContain("Paused. New events wait until you resume.");
    expect(pageText()).not.toContain("Why events are skipped");
    expect(pageText()).not.toContain("nothing needed copying");
  });

  it("resumes a paused calendar from its row", async () => {
    await mount(sync({ sources: [{ calendarId: "work", problem: "disabled" }] }));
    expect(pageText()).toContain("Work is paused");
    expect(pageText()).not.toContain("Reconnect");
    const resume = [...(mounted?.document.querySelectorAll("button") ?? [])].find((element) => element.textContent?.includes("Work is paused"));
    if (!resume) throw new Error("no Resume row");
    mounted?.fire(resume, "click");
    await settle();
    expect(requests).toContainEqual({ body: { paused: false }, method: "PATCH", url: "/api/sources/work" });
  });
});

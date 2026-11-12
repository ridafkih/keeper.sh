import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import type { SyncDetail } from "@keeper.sh/data-schemas";
import { DEFAULT_SYNC_SETTINGS } from "@keeper.sh/data-schemas";
import { mountDom, type MountedDom } from "../../../helpers/mount-dom";
import type * as Analytics from "../../../../src/lib/analytics";
import { makeSource } from "../../setup/fixtures";
import { fetcher } from "../../../../src/lib/fetcher";
import { STALE_SYNC_MESSAGE } from "../../../../src/features/syncs/sync-errors";
import { SyncPage } from "../../../../src/features/syncs/components/sync-page";

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
    data: { accounts: { current: 2, limit: null }, canUseEventFilters: true, plan: "pro", syncCalendars: { limit: null }, syncs: { current: 1, limit: null } },
    isLoading: false,
  }),
}));

const calendars = [
  makeSource("work", "google", ["pull", "push"], { name: "Work" }),
  makeSource("personal", "icloud", ["pull", "push"], { name: "Personal" }),
  makeSource("family", "icloud", ["pull", "push"], { name: "Family" }),
];

const baseSync = (): SyncDetail => ({
  ...DEFAULT_SYNC_SETTINGS,
  copiedCount: 0,
  createdAt: "2026-10-01T09:00:00.000Z",
  destinationCalendarIds: ["personal"],
  destinations: [{ calendarId: "personal", copiedCount: 0, lastSyncedAt: null, problem: null, skippedCount: 0 }],
  id: "s1",
  lastSyncedAt: null,
  memberCalendarIds: [],
  mode: "one_way",
  name: "Work out",
  pairCount: 1,
  paused: false,
  skippedCount: 0,
  sourceCalendarIds: ["work"],
  sources: [{ calendarId: "work", problem: null }],
  state: "ok",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

interface Server {
  sync: SyncDetail;
  getStatus: number;
  patches: Record<string, unknown>[];
  respondToPatch: (body: Record<string, unknown>) => { status: number; body: unknown };
}

let server: Server;
let mounted: MountedDom | null = null;
let swrMutate: ((key: string) => Promise<unknown>) | null = null;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });

const tick = (count = 1) => {
  let updatedAt = server.sync.updatedAt;
  for (let step = 0; step < count; step++) updatedAt = new Date(Date.parse(updatedAt) + 60_000).toISOString();
  return updatedAt;
};

const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url === "/api/sources") return json(200, calendars);
  if (url === "/api/syncs" && method === "GET") return json(200, [server.sync]);
  if (url === "/api/syncs/s1" && method === "GET") {
    if (server.getStatus !== 200) return json(server.getStatus, { error: "Nope" });
    return json(200, server.sync);
  }
  if (url === "/api/syncs/s1" && method === "PATCH") {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    server.patches.push(body);
    const answer = server.respondToPatch(body);
    return json(answer.status, answer.body);
  }
  return json(404, { error: `unexpected ${method} ${url}` });
};

const applyPatch = (body: Record<string, unknown>) => {
  const fields = { ...body };
  delete fields.expectedUpdatedAt;
  server.sync = { ...server.sync, ...fields, updatedAt: tick() };
  return { body: server.sync, status: 200 };
};

const holdMutate = (mutate: (key: string) => Promise<unknown>) => {
  swrMutate = mutate;
};

function GrabMutate({ onMutate }: { onMutate: typeof holdMutate }) {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    onMutate((key) => mutate(key));
  }, [mutate, onMutate]);
  return null;
}

const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round++) {
    await mounted?.flush();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

const mount = async () => {
  mounted = mountDom(
    <SWRConfig value={{ dedupingInterval: 0, fetcher, provider: () => new Map(), revalidateOnFocus: false, shouldRetryOnError: false }}>
      <GrabMutate onMutate={holdMutate} />
      <SyncPage syncId="s1" tab="setup" />
    </SWRConfig>,
  );
  await settle();
  return mounted;
};

const buttons = (): HTMLElement[] => [...(mounted?.document.querySelectorAll("button") ?? [])] as HTMLElement[];

const button = (match: (element: HTMLElement) => boolean, what: string): HTMLElement => {
  const found = buttons().find(match);
  if (!found) throw new Error(`No button for ${what}`);
  return found;
};

const byLabel = (label: string) => button((element) => element.getAttribute("aria-label") === label, label);
const byText = (text: string) => button((element) => element.textContent?.trim() === text, text);
const byRole = (role: string, text: string) =>
  button((element) => element.getAttribute("role") === role && Boolean(element.textContent?.includes(text)), `${role} ${text}`);

const click = async (element: HTMLElement) => {
  mounted?.fire(element, "click");
  await settle();
};

const pageText = (): string => mounted?.document.body.textContent ?? "";

beforeEach(() => {
  router.blocked = false;
  router.navigate.mockReset();
  router.search = {};
  router.shouldBlock = null;
  server = { getStatus: 200, patches: [], respondToPatch: applyPatch, sync: baseSync() };
  vi.stubGlobal("fetch", vi.fn(handle));
  vi.stubGlobal("getComputedStyle", () => ({ overflowY: "visible", position: "static" }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => clearTimeout(frame));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  swrMutate = null;
  vi.unstubAllGlobals();
});

const addFamilyAsDestination = async () => {
  await click(byLabel("Add a calendar to copy to"));
  await click(byRole("checkbox", "Family"));
};

describe("SyncPage", () => {
  it("keeps a pause made after a calendar edit: Save sends the calendar alone, checked against the latest copy", async () => {
    await mount();
    await addFamilyAsDestination();
    expect(pageText()).toContain("Unsaved changes");

    await click(byRole("switch", "Pause This Sync"));
    expect(server.patches).toEqual([{ paused: true }]);
    const pausedAt = server.sync.updatedAt;

    await click(byText("Save"));
    expect(server.patches[1]).toEqual({ destinationCalendarIds: ["personal", "family"], expectedUpdatedAt: pausedAt });
    expect(server.sync).toMatchObject({ destinationCalendarIds: ["personal", "family"], paused: true });
    expect(pageText()).not.toContain("Unsaved changes");
  });

  it("refetches and says so when the sync changed elsewhere, keeping the edits for another try", async () => {
    await mount();
    await addFamilyAsDestination();
    server.respondToPatch = () => ({ body: { error: "This sync changed since you opened it.", stale: true }, status: 409 });
    server.sync = { ...server.sync, name: "Renamed elsewhere", updatedAt: tick(5) };

    await click(byText("Save"));
    expect(pageText()).toContain(STALE_SYNC_MESSAGE);
    expect(pageText()).toContain("Renamed elsewhere");
    expect(pageText()).toContain("Unsaved changes");

    server.respondToPatch = applyPatch;
    const latest = server.sync.updatedAt;
    await click(byText("Save"));
    expect(server.patches[1]).toEqual({ destinationCalendarIds: ["personal", "family"], expectedUpdatedAt: latest });
  });

  it("still offers the discard dialog when a refresh fails with unsaved edits", async () => {
    await mount();
    await addFamilyAsDestination();
    server.getStatus = 500;
    router.blocked = true;
    await swrMutate?.("/api/syncs/s1");
    await settle();

    expect(router.shouldBlock?.({ current: { pathname: "/dashboard/syncs/s1" }, next: { pathname: "/dashboard" } })).toBe(true);
    expect(pageText()).toContain("Couldn't refresh this sync.");
    expect(pageText()).toContain("Discard unsaved changes?");
  });

  it("lets navigation go once the sync turns out to be deleted, and still renders the dialog", async () => {
    await mount();
    await addFamilyAsDestination();
    server.getStatus = 404;
    router.blocked = true;
    await swrMutate?.("/api/syncs/s1");
    await settle();

    expect(router.shouldBlock?.({ current: { pathname: "/dashboard/syncs/s1" }, next: { pathname: "/dashboard" } })).toBe(false);
    expect(pageText()).toContain("This sync no longer exists.");
    expect(pageText()).toContain("Discard unsaved changes?");
  });

  it("adds a newly connected calendar from ?addCalendar to the draft and drops the param", async () => {
    router.search = { addCalendar: "family" };
    await mount();

    expect(pageText()).toContain("Unsaved changes");
    expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true, to: "/dashboard/syncs/$syncId" }));
    router.search = {};
    await click(byText("Save"));
    expect(server.patches[0]).toMatchObject({ destinationCalendarIds: ["personal", "family"] });
  });

  it("reviews a save that deletes copies, naming them", async () => {
    server.sync = { ...server.sync, destinationCalendarIds: ["personal", "family"] };
    await mount();
    await click(byLabel("Add a calendar to copy to"));
    await click(byRole("checkbox", "Family"));
    await click(byText("Save"));

    expect(server.patches).toEqual([]);
    expect(pageText()).toContain("Copies of Work are removed from Family.");
  });
});

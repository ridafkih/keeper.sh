import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { mountDom, type MountedDom } from "../../../helpers/mount-dom";
import type * as Analytics from "../../../../src/lib/analytics";
import { makeSource } from "../../setup/fixtures";
import { fetcher } from "../../../../src/lib/fetcher";
import { NewSyncPage } from "../../../../src/features/syncs/components/new-sync-page";
import type { NewSyncSearch } from "../../../../src/features/syncs/sync-draft";

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
  makeSource("family", "icloud", ["pull", "push"], { name: "Family" }),
  makeSource("school", "outlook", ["pull", "push"], { name: "School" }),
  makeSource("gym", "outlook", ["pull", "push"], { name: "Gym" }),
];

let mounted: MountedDom | null = null;
let posted: Record<string, unknown>[] = [];

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });

const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url === "/api/sources") return json(200, calendars);
  if (url === "/api/syncs" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posted.push(body);
    return json(201, { ...body, id: "new-sync" });
  }
  if (url === "/api/syncs") return json(200, []);
  return json(404, { error: `unexpected ${url}` });
};

const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round++) {
    await mounted?.flush();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

const mount = async (search: NewSyncSearch = {}) => {
  mounted = mountDom(
    <SWRConfig value={{ dedupingInterval: 0, fetcher, provider: () => new Map(), revalidateOnFocus: false, shouldRetryOnError: false }}>
      <NewSyncPage search={search} />
    </SWRConfig>,
  );
  await settle();
};

const buttons = (): HTMLElement[] => [...(mounted?.document.querySelectorAll("button") ?? [])] as HTMLElement[];

const button = (match: (element: HTMLElement) => boolean, what: string): HTMLElement => {
  const found = buttons().find(match);
  if (!found) throw new Error(`No button for ${what}`);
  return found;
};

const textOf = (element: HTMLElement): string => (element.textContent ?? "").replace(/\u200B/g, "").trim();
const byText = (text: string) => button((element) => textOf(element) === text, text);
const containing = (text: string) => button((element) => Boolean(element.textContent?.includes(text)), text);
const byRole = (role: string, text: string) =>
  button((element) => element.getAttribute("role") === role && Boolean(element.textContent?.includes(text)), `${role} ${text}`);

const click = async (element: HTMLElement) => {
  mounted?.fire(element, "click");
  await settle();
};

const pageText = (): string => mounted?.document.body.textContent ?? "";
const leaving = () => router.shouldBlock?.({ current: { pathname: "/dashboard/syncs/new" }, next: { pathname: "/dashboard" } });

beforeEach(() => {
  posted = [];
  router.blocked = false;
  router.navigate.mockReset();
  router.shouldBlock = null;
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

describe("NewSyncPage on a free plan", () => {
  it("labels the Pro profiles and says what Pro would add", async () => {
    await mount();
    expect(pageText()).toContain("Both ways · Busy Only · Pro adds skipping all-day and focus time");
    expect(pageText()).toContain("One way · Busy Only · Pro adds Full Details and private copies");
  });

  it("starts a profile without its Pro settings, so Create sends what the plan allows", async () => {
    await mount();
    await click(containing("Block My Time"));
    expect(byRole("switch", "All-Day Events").getAttribute("aria-checked")).toBe("false");
    expect(byRole("switch", "All-Day Events").hasAttribute("disabled")).toBe(true);

    await click(byText("two or more calendars"));
    await click(byRole("checkbox", "Work"));
    await click(byRole("checkbox", "Personal"));
    await click(byText("Create Sync"));
    expect(posted).toEqual([expect.objectContaining({ memberCalendarIds: ["work", "personal"], shareAs: "busy_only", skipAllDay: false, skipFocusTime: false })]);
    expect(router.navigate).toHaveBeenCalledWith({ ignoreBlocker: true, to: "/dashboard/syncs/new-sync" });
  });

  it("stops at the free calendar limit and says why", async () => {
    await mount({ profile: "block_my_time" });
    await click(byText("two or more calendars"));
    for (const name of ["Work", "Personal", "Family"]) await click(byRole("checkbox", name));
    expect(byRole("checkbox", "School").hasAttribute("disabled")).toBe(true);
    expect(pageText()).toContain("This sync is at the free plan's 3-calendar limit.");
  });

  it("guards an edited draft, and asks before Change Profile throws it away", async () => {
    await mount({ profile: "work_copy" });
    expect(leaving()).toBe(false);

    await click(byText("a calendar"));
    await click(byRole("checkbox", "Work"));
    expect(leaving()).toBe(true);

    await click(byText("Change Profile"));
    expect(pageText()).toContain("Picking another profile starts over");
    expect(pageText()).toContain("Work Copy");

    await click(byText("Discard"));
    expect(pageText()).toContain("Start From Scratch");
    expect(leaving()).toBe(false);
  });

  it("goes straight back to the profiles when nothing was changed", async () => {
    await mount({ profile: "work_copy" });
    await click(byText("Change Profile"));
    expect(pageText()).not.toContain("Picking another profile starts over");
    expect(pageText()).toContain("Start From Scratch");
  });
});

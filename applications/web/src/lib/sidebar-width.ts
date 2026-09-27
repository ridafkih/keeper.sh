const WIDE_SIDEBAR_ROOT = "/dashboard/syncs";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

// Sync pages carry sentences of calendar names, so they get a wider sidebar at the calendar's expense.
export const isWideSidebarPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  return path === WIDE_SIDEBAR_ROOT || path.startsWith(`${WIDE_SIDEBAR_ROOT}/`);
};

const FULL_SCREEN_PATHS = new Set(["/dashboard/setup"]);

// Onboarding needs the whole window for the editor and its preview, so it drops the sidebar and calendar.
export const isFullScreenPath = (pathname: string): boolean => FULL_SCREEN_PATHS.has(normalizePath(pathname));

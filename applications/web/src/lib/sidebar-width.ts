const WIDE_SIDEBAR_ROOT = "/dashboard/syncs";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

// Sync pages carry sentences of calendar names, so they get a wider sidebar at the calendar's expense.
export const isWideSidebarPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  return path === WIDE_SIDEBAR_ROOT || path.startsWith(`${WIDE_SIDEBAR_ROOT}/`);
};

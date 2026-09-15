const WIDE_SIDEBAR_ROOT = "/dashboard/rules";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

// Pages whose rows carry two calendar names get a wider sidebar, at the calendar's expense.
export const isWideSidebarPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  return path === WIDE_SIDEBAR_ROOT || path.startsWith(`${WIDE_SIDEBAR_ROOT}/`);
};

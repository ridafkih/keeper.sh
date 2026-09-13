const WIDE_SIDEBAR_PATHS = new Set(["/dashboard/rules"]);

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

// Pages whose rows carry two calendar names get a wider sidebar, at the calendar's expense.
export const isWideSidebarPath = (pathname: string): boolean => WIDE_SIDEBAR_PATHS.has(normalizePath(pathname));

const WIDE_SIDEBAR_PATHS = new Set(["/dashboard/syncs/new"]);
const SYNCS_ROOT = "/dashboard/syncs";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

// The new-sync editor carries sentences of calendar names, so it gets a wider sidebar at the calendar's expense.
export const isWideSidebarPath = (pathname: string): boolean => WIDE_SIDEBAR_PATHS.has(normalizePath(pathname));

// A sync's page opens in place of the calendar, with the list of syncs kept in the sidebar.
export const isSyncDetailPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  if (!path.startsWith(`${SYNCS_ROOT}/`)) return false;
  const rest = path.slice(SYNCS_ROOT.length + 1);
  return rest !== "" && rest !== "new" && !rest.includes("/");
};

const FULL_SCREEN_PATHS = new Set(["/dashboard/setup"]);

// Onboarding needs the whole window for the editor and its preview, so it drops the sidebar and calendar.
export const isFullScreenPath = (pathname: string): boolean => FULL_SCREEN_PATHS.has(normalizePath(pathname));

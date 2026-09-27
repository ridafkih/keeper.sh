const SYNCS_ROOT = "/dashboard/syncs";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

export type SyncPane = { kind: "new" } | { kind: "sync"; syncId: string };

// A sync's page and the new-sync editor open in place of the calendar, with the list of syncs kept in the sidebar.
export const resolveSyncPane = (pathname: string): SyncPane | null => {
  const path = normalizePath(pathname);
  if (!path.startsWith(`${SYNCS_ROOT}/`)) return null;
  const rest = path.slice(SYNCS_ROOT.length + 1);
  if (rest === "" || rest.includes("/")) return null;
  return rest === "new" ? { kind: "new" } : { kind: "sync", syncId: rest };
};

const FULL_SCREEN_PATHS = new Set(["/dashboard/setup"]);

// Onboarding needs the whole window for the editor and its preview, so it drops the sidebar and calendar.
export const isFullScreenPath = (pathname: string): boolean => FULL_SCREEN_PATHS.has(normalizePath(pathname));

export const isSyncsListPath = (pathname: string): boolean => normalizePath(pathname) === SYNCS_ROOT;

// Every sync pane keeps the syncs list in the sidebar, so the sidebar only moves when that list comes or goes.
export const resolveSidebarPagePath = (pathname: string): string =>
  resolveSyncPane(pathname) ? SYNCS_ROOT : normalizePath(pathname);

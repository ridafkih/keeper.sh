const MOVED_PATHS: Record<string, string> = {
  "/blog/best-calendar-sync-tools": "/compare/best-calendar-sync-tools",
  "/blog/keeper-sh-vs-calendarbridge": "/compare/calendarbridge-alternative",
  "/blog/keeper-sh-vs-kalender-sync": "/compare/kalender-sync-alternative",
  "/blog/keeper-sh-vs-morgen": "/compare/morgen-alternative",
  "/blog/keeper-sh-vs-onecal": "/compare/onecal-alternative",
  "/blog/keeper-sh-vs-reclaim-ai": "/compare/reclaim-ai-alternative",
  "/blog/keeper-sh-vs-syncdate": "/compare/syncdate-alternative",
  "/blog/keeper-sh-vs-syncthemcalendars": "/compare/syncthemcalendars-alternative",
};

export function resolveMovedPath(pathname: string): string | null {
  return MOVED_PATHS[pathname] ?? null;
}

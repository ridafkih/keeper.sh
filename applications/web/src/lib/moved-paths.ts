const MOVED_PATHS: Record<string, string> = {
  "/blog/how-to-sync-google-calendar-with-outlook": "/blog/sync-google-calendar-with-outlook",
  "/blog/how-to-sync-outlook-calendar-with-google-calendar": "/blog/sync-google-calendar-with-outlook",
  "/blog/sync-google-calendar-with-icloud": "/blog/how-to-add-google-calendar-to-iphone",
  "/blog/sync-icloud-calendar-with-google-calendar": "/blog/how-to-sync-apple-calendar-to-google-calendar",
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

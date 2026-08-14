const MOVED_PATHS: Record<string, string> = {
  "/blog/keeper-sh-vs-calendarbridge": "/compare/calendarbridge-alternative",
  "/blog/keeper-sh-vs-onecal": "/compare/onecal-alternative",
  "/blog/keeper-sh-vs-syncthemcalendars": "/compare/syncthemcalendars-alternative",
};

export function resolveMovedPath(pathname: string): string | null {
  return MOVED_PATHS[pathname] ?? null;
}

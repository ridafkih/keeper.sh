import type { CalendarId } from "@keeper.sh/sync-protocol";
import { normalizeResourcePath } from "./resource-path";

const withTrailingSlash = (pathname: string): string => {
  if (pathname.endsWith("/")) {
    return pathname;
  }
  return `${pathname}/`;
};

const normalizeCollectionKey = (href: string, base: string): CalendarId => ({
  kind: "calendarId",
  value: withTrailingSlash(normalizeResourcePath(href, base)),
});

export { normalizeCollectionKey };

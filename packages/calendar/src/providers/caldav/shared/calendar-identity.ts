const TRAILING_SLASHES = /\/+$/u;

const normalizeCalDAVCalendarKey = (calendarUrl: string): string =>
  decodeURIComponent(new URL(calendarUrl).pathname).replace(TRAILING_SLASHES, "");

const normalizeCalDAVServerHost = (serverUrl: string): string =>
  new URL(serverUrl).hostname.toLowerCase();

const findCalendarByStoredUrl = <TCalendar extends { url: string }>(
  calendars: TCalendar[],
  storedUrl: string,
): TCalendar | null => {
  const storedKey = normalizeCalDAVCalendarKey(storedUrl);

  return calendars.find(
    (calendar) => normalizeCalDAVCalendarKey(calendar.url) === storedKey,
  ) ?? null;
};

const resolveCalDAVServerHost = (serverUrl: string | null): string | null => {
  if (serverUrl === null) {
    return null;
  }

  return normalizeCalDAVServerHost(serverUrl);
};

export {
  findCalendarByStoredUrl,
  normalizeCalDAVCalendarKey,
  normalizeCalDAVServerHost,
  resolveCalDAVServerHost,
};

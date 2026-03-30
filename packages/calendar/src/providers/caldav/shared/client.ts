import { createDAVClient } from "tsdav";
import { validateUrlSafety } from "../../../utils/safe-fetch";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import type { CalDAVClientConfig, CalendarInfo } from "../types";

interface CalendarObject {
  url: string;
  etag?: string;
  data?: string;
}

type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;

const getDisplayName = (name: unknown): string => {
  if (typeof name === "string") {
    return name;
  }
  return "Unnamed Calendar";
};

// TODO: Some CalDAV servers (e.g. Lark) don't support the "expand" flag for
// Recurring events. When expand is requested, they return objects with non-string
// Data (e.g. `{}`) instead of expanded iCal strings. This fallback retries without
// Expand so we still get the raw calendar data, but it means recurring events come
// Back as a single master event with an RRULE instead of individual occurrences.
// Since parseICalToRemoteEvent only extracts the first VEVENT per object, modified
// Occurrences of recurring events will be lost for these servers. A proper fix would
// Be to handle multi-VEVENT objects and/or forward RRULEs to destinations.
const fetchCalendarObjectsWithExpandFallback = async (
  client: DAVClientInstance,
  params: { calendarUrl: string; timeRange?: { start: string; end: string } },
): Promise<CalendarObject[]> => {
  const expandedObjects = await client.fetchCalendarObjects({
    calendar: { url: params.calendarUrl },
    expand: true,
    ...(params.timeRange && { timeRange: params.timeRange }),
  });

  const hasValidData = expandedObjects.some(
    (object) => typeof object.data === "string",
  );

  if (hasValidData) {
    return expandedObjects;
  }

  const unexpandedObjects = await client.fetchCalendarObjects({
    calendar: { url: params.calendarUrl },
    ...(params.timeRange && { timeRange: params.timeRange }),
  });

  return unexpandedObjects;
};

class CalDAVClient {
  private client: DAVClientInstance | null = null;
  private config: CalDAVClientConfig;
  private safeFetchOptions?: SafeFetchOptions;

  constructor(config: CalDAVClientConfig, safeFetchOptions?: SafeFetchOptions) {
    this.config = config;
    this.safeFetchOptions = safeFetchOptions;
  }

  private async getClient(): Promise<DAVClientInstance> {
    if (!this.client) {
      await validateUrlSafety(this.config.serverUrl, this.safeFetchOptions);
      this.client = await createDAVClient({
        authMethod: "Basic",
        credentials: this.config.credentials,
        defaultAccountType: "caldav",
        serverUrl: this.config.serverUrl,
      });
    }
    return this.client;
  }

  async discoverCalendars(): Promise<CalendarInfo[]> {
    const client = await this.getClient();
    const calendars = await client.fetchCalendars();

    return calendars.map(({ url, displayName, ctag }) => ({
      ctag,
      displayName: getDisplayName(displayName),
      url,
    }));
  }

  async fetchCalendarDisplayName(calendarUrl: string): Promise<string | null> {
    const calendars = await this.discoverCalendars();
    const storedPath = new URL(calendarUrl).pathname;

    const matchingCalendar = calendars.find(
      (calendar) => new URL(calendar.url).pathname === storedPath,
    );

    return matchingCalendar?.displayName ?? null;
  }

  async resolveCalendarUrl(storedUrl: string): Promise<string> {
    const calendars = await this.discoverCalendars();
    const storedPath = new URL(storedUrl).pathname;

    const matchingCalendar = calendars.find(
      (calendar) => new URL(calendar.url).pathname === storedPath,
    );

    return matchingCalendar?.url ?? storedUrl;
  }

  async createCalendarObject(params: {
    calendarUrl: string;
    filename: string;
    iCalString: string;
  }): Promise<void> {
    const client = await this.getClient();

    const response = await client.createCalendarObject({
      calendar: { url: params.calendarUrl },
      filename: params.filename,
      iCalString: params.iCalString,
    });

    await response.body?.cancel?.();
  }

  async deleteCalendarObject(params: { calendarUrl: string; filename: string }): Promise<void> {
    const client = await this.getClient();
    const objectUrl = CalDAVClient.normalizeUrl(params.calendarUrl, params.filename);

    const response = await client.deleteCalendarObject({
      calendarObject: { url: objectUrl },
    });

    await response.body?.cancel?.();
  }

  async fetchCalendarObjects(params: {
    calendarUrl: string;
    timeRange?: { start: string; end: string };
  }): Promise<CalendarObject[]> {
    const client = await this.getClient();
    return fetchCalendarObjectsWithExpandFallback(client, params);
  }

  private static ensureTrailingSlash(url: string): string {
    if (url.endsWith("/")) {
      return url;
    }

    return `${url}/`;
  }

  private static normalizeUrl(calendarUrl: string, filename: string): string {
    const base = CalDAVClient.ensureTrailingSlash(calendarUrl);
    return `${base}${filename}`;
  }
}

const createCalDAVClient = (config: CalDAVClientConfig, safeFetchOptions?: SafeFetchOptions): CalDAVClient =>
  new CalDAVClient(config, safeFetchOptions);

export { CalDAVClient, createCalDAVClient };

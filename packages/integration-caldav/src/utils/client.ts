import { createDAVClient } from "tsdav";

interface CalDAVClientConfig {
  serverUrl: string;
  credentials: {
    username: string;
    password: string;
  };
}

interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
}

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

class CalDAVClient {
  private client: DAVClientInstance | null = null;
  private config: CalDAVClientConfig;

  constructor(config: CalDAVClientConfig) {
    this.config = config;
  }

  private async getClient(): Promise<DAVClientInstance> {
    if (!this.client) {
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

    await client.createCalendarObject({
      calendar: { url: params.calendarUrl },
      filename: params.filename,
      iCalString: params.iCalString,
    });
  }

  async deleteCalendarObject(params: { calendarUrl: string; filename: string }): Promise<void> {
    const client = await this.getClient();
    const objectUrl = CalDAVClient.normalizeUrl(params.calendarUrl, params.filename);

    await client.deleteCalendarObject({
      calendarObject: { url: objectUrl },
    });
  }

  async fetchCalendarObjects(params: {
    calendarUrl: string;
    timeRange?: { start: string; end: string };
  }): Promise<CalendarObject[]> {
    const client = await this.getClient();

    const objects = await client.fetchCalendarObjects({
      calendar: { url: params.calendarUrl },
      expand: true,
      ...(params.timeRange && { timeRange: params.timeRange }),
    });

    return objects;
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

const createCalDAVClient = (config: CalDAVClientConfig): CalDAVClient => new CalDAVClient(config);

export { CalDAVClient, createCalDAVClient };
export type { CalDAVClientConfig, CalendarInfo, CalendarObject };

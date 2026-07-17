import { createDAVClient } from "tsdav";
import { createSafeFetch } from "../../../utils/safe-fetch";
import { createDigestAwareFetch } from "./digest-fetch";
import type { CalDAVAuthMethod } from "./digest-fetch";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import type { CalDAVClientConfig, CalendarInfo } from "../types";

interface CalendarObject {
  url: string;
  etag?: string;
  data?: string;
}

type CalDAVWriteOperation = "create" | "delete";

class CalDAVHttpError extends Error {
  readonly operation: CalDAVWriteOperation;
  readonly status: number;

  constructor(response: Response, operation: CalDAVWriteOperation) {
    super(`CalDAV ${operation} failed: ${response.status} ${response.statusText}`.trim());
    this.name = "CalDAVHttpError";
    this.operation = operation;
    this.status = response.status;
  }
}

class CalDAVCreateConflictError extends CalDAVHttpError {
  constructor(response: Response) {
    super(response, "create");
    this.name = "CalDAVCreateConflictError";
  }
}

const releaseResponseBody = async (response: Response): Promise<void> => {
  await response.body?.cancel();
};

const assertSuccessfulResponse = async (
  response: Response,
  operation: CalDAVWriteOperation,
): Promise<void> => {
  await releaseResponseBody(response);
  if (!response.ok) {
    throw new CalDAVHttpError(response, operation);
  }
};

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
  private safeFetchOptions?: SafeFetchOptions;
  private resolvedAuthMethod: (() => CalDAVAuthMethod | null) | null = null;

  constructor(config: CalDAVClientConfig, safeFetchOptions?: SafeFetchOptions) {
    this.config = config;
    this.safeFetchOptions = safeFetchOptions;
  }

  getResolvedAuthMethod(): CalDAVAuthMethod | null {
    return this.resolvedAuthMethod?.() ?? null;
  }

  private async getClient(): Promise<DAVClientInstance> {
    if (!this.client) {
      const safeFetch = createSafeFetch(this.safeFetchOptions);
      const { fetch: digestAwareFetch, getResolvedMethod } = createDigestAwareFetch({
        credentials: this.config.credentials,
        baseFetch: safeFetch,
        knownAuthMethod: this.config.authMethod,
      });
      this.resolvedAuthMethod = getResolvedMethod;
      this.client = await createDAVClient({
        authMethod: "Custom",
        authFunction: () => Promise.resolve({}),
        credentials: this.config.credentials,
        defaultAccountType: "caldav",
        fetch: digestAwareFetch,
        serverUrl: this.config.serverUrl,
      });
    }
    return this.client;
  }

  async discoverCalendars(): Promise<CalendarInfo[]> {
    const client = await this.getClient();
    const calendars = await client.fetchCalendars();

    return calendars
      .filter(({ components }) => components?.includes("VEVENT"))
      .map(({ url, displayName, ctag }) => ({
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

    if (response.status === 412) {
      await releaseResponseBody(response);
      throw new CalDAVCreateConflictError(response);
    }
    await assertSuccessfulResponse(response, "create");
  }

  async deleteCalendarObject(params: {
    calendarUrl: string;
    filename: string;
    etag?: string;
  }): Promise<void> {
    const client = await this.getClient();
    const objectUrl = CalDAVClient.normalizeUrl(params.calendarUrl, params.filename);

    const response = await client.deleteCalendarObject({
      calendarObject: { url: objectUrl, etag: params.etag },
    });

    await assertSuccessfulResponse(response, "delete");
  }

  async fetchCalendarObject(params: {
    calendarUrl: string;
    filename: string;
  }): Promise<CalendarObject | null> {
    const client = await this.getClient();
    const objectUrl = CalDAVClient.normalizeUrl(params.calendarUrl, params.filename);
    const objects = await client.fetchCalendarObjects({
      calendar: { url: params.calendarUrl },
      objectUrls: [objectUrl],
    });

    return objects[0] ?? null;
  }

  async fetchCalendarObjects(params: {
    calendarUrl: string;
    timeRange?: { start: string; end: string };
  }): Promise<CalendarObject[]> {
    const client = await this.getClient();

    const objects = await client.fetchCalendarObjects({
      calendar: { url: params.calendarUrl },
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

const createCalDAVClient = (config: CalDAVClientConfig, safeFetchOptions?: SafeFetchOptions): CalDAVClient =>
  new CalDAVClient(config, safeFetchOptions);

export { CalDAVClient, CalDAVCreateConflictError, CalDAVHttpError, createCalDAVClient };

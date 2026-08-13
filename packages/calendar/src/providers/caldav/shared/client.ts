import { HTTP_STATUS } from "@keeper.sh/constants";
import { createDAVClient, DAVNamespaceShort } from "tsdav";
import { chunkArray } from "../../../core/utils/chunk";
import { createSafeFetch } from "../../../utils/safe-fetch";
import {
  buildCalendarObjectFilters,
  CALDAV_MULTIGET_BATCH_SIZE,
  isCalendarObjectPath,
} from "./api";
import { createDigestAwareFetch } from "./digest-fetch";
import { runInRequestScope } from "./response-status-scope";
import type { CalDAVAuthMethod } from "./digest-fetch";
import type { SafeFetchOptions, WithheldCredentials } from "../../../utils/safe-fetch";
import type { CalDAVClientConfig, CalendarInfo } from "../types";

const MISSING_HREF_SAMPLE_SIZE = 5;

interface CalendarObject {
  url: string;
  etag?: string;
  data?: string;
}

interface CalDAVIncompleteMultiGetDetails {
  batchCount: number;
  calendarUrl: string;
  hrefsRequested: number;
  missingHrefs: string[];
  objectsReturned: number;
}

class CalDAVIncompleteMultiGetError extends Error {
  readonly batchCount: number;
  readonly calendarUrl: string;
  readonly hrefsRequested: number;
  readonly missingHrefs: string[];
  readonly objectsReturned: number;

  constructor(details: CalDAVIncompleteMultiGetDetails) {
    super(
      `CalDAV multiget returned ${details.objectsReturned} of ${details.hrefsRequested} requested objects for ${details.calendarUrl}`,
    );
    this.name = "CalDAVIncompleteMultiGetError";
    this.batchCount = details.batchCount;
    this.calendarUrl = details.calendarUrl;
    this.hrefsRequested = details.hrefsRequested;
    this.missingHrefs = details.missingHrefs.slice(0, MISSING_HREF_SAMPLE_SIZE);
    this.objectsReturned = details.objectsReturned;
  }
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

class CalDAVAuthenticationError extends Error {
  readonly status = HTTP_STATUS.UNAUTHORIZED;

  constructor(cause: unknown) {
    super("Invalid credentials", { cause });
    this.name = "CalDAVAuthenticationError";
  }
}

class CalDAVWithheldCredentialsError extends Error {
  readonly redirectedTo: string;

  constructor(details: WithheldCredentials, cause: unknown) {
    super(
      `CalDAV redirect to ${details.redirectedTo} crossed a security boundary, so the request was sent without credentials and the server refused it`,
      { cause },
    );
    this.name = "CalDAVWithheldCredentialsError";
    this.redirectedTo = details.redirectedTo;
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

class CalDAVUnauthorizedResponseError extends Error {
  readonly status = HTTP_STATUS.UNAUTHORIZED;

  constructor() {
    super("CalDAV operation completed on an unauthorized response");
    this.name = "CalDAVUnauthorizedResponseError";
  }
}

const mapAuthenticationFailure = <Result>(operation: () => Promise<Result>): Promise<Result> =>
  runInRequestScope(async (requests) => {
    const raiseUnauthorizedVerdict = (cause: unknown): never => {
      if (requests.hasUnrefutedUnauthorized()) {
        throw new CalDAVAuthenticationError(cause);
      }

      const withheld = requests.findUnrefutedWithheldCredentials();
      if (withheld) {
        throw new CalDAVWithheldCredentialsError(withheld, cause);
      }

      throw cause;
    };

    const result = await operation().catch((error: unknown) => {
      if (requests.isPropagatedTransportFailure(error)) {
        throw error;
      }
      return raiseUnauthorizedVerdict(error);
    });

    if (requests.hasUnrefutedUnauthorized() || requests.findUnrefutedWithheldCredentials()) {
      return raiseUnauthorizedVerdict(new CalDAVUnauthorizedResponseError());
    }

    return result;
  });

const getDisplayName = (name: unknown): string => {
  if (typeof name === "string") {
    return name;
  }
  return "Unnamed Calendar";
};

const toCalendarObjectPath = (href: string, calendarUrl: string): string =>
  new URL(href, calendarUrl).pathname;

const toRequestedPaths = (responses: { href?: string }[], calendarUrl: string): string[] => [
  ...new Set(
    responses
      .map(({ href }) => toCalendarObjectPath(href ?? "", calendarUrl))
      .filter((path) => isCalendarObjectPath(path)),
  ),
];

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
    const calendars = await mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      return client.fetchCalendars();
    });

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

  fetchCalendarObject(params: {
    calendarUrl: string;
    filename: string;
  }): Promise<CalendarObject | null> {
    return mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      const objectUrl = CalDAVClient.normalizeUrl(params.calendarUrl, params.filename);
      const objects = await client.fetchCalendarObjects({
        calendar: { url: params.calendarUrl },
        objectUrls: [objectUrl],
      });

      return objects[0] ?? null;
    });
  }

  fetchCalendarObjects(params: {
    calendarUrl: string;
    timeRange?: { start: string; end: string };
  }): Promise<CalendarObject[]> {
    return mapAuthenticationFailure(async () => {
      const client = await this.getClient();

      const queryResponses = await client.calendarQuery({
        depth: "1",
        filters: buildCalendarObjectFilters(params.timeRange),
        props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
        url: params.calendarUrl,
      });

      const requestedPaths = toRequestedPaths(queryResponses, params.calendarUrl);
      if (requestedPaths.length === 0) {
        return [];
      }

      const batches = chunkArray(requestedPaths, CALDAV_MULTIGET_BATCH_SIZE);
      const batchResults: CalendarObject[][] = [];

      for (const objectUrls of batches) {
        const objects = await client.fetchCalendarObjects({
          calendar: { url: params.calendarUrl },
          objectUrls,
          urlFilter: (url) => isCalendarObjectPath(toCalendarObjectPath(url, params.calendarUrl)),
        });
        batchResults.push(
          objects.filter((object): object is CalendarObject => typeof object.data === "string"),
        );
      }

      const objectsByPath = new Map(
        batchResults
          .flat()
          .map((object) => [toCalendarObjectPath(object.url, params.calendarUrl), object]),
      );

      const missingHrefs = requestedPaths.filter((path) => !objectsByPath.has(path));
      if (missingHrefs.length > 0) {
        throw new CalDAVIncompleteMultiGetError({
          batchCount: batches.length,
          calendarUrl: params.calendarUrl,
          hrefsRequested: requestedPaths.length,
          missingHrefs,
          objectsReturned: requestedPaths.length - missingHrefs.length,
        });
      }

      return requestedPaths.flatMap((path) => {
        const object = objectsByPath.get(path);
        if (!object) {
          return [];
        }
        return [object];
      });
    });
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

export {
  CalDAVAuthenticationError,
  CalDAVClient,
  CalDAVCreateConflictError,
  CalDAVHttpError,
  CalDAVIncompleteMultiGetError,
  CalDAVWithheldCredentialsError,
  createCalDAVClient,
};

import { HTTP_STATUS } from "@keeper.sh/constants";
import { createDAVClient, DAVNamespaceShort } from "tsdav";
import { chunkArray } from "../../../core/utils/chunk";
import { createSafeFetch } from "../../../utils/safe-fetch";
import { sleepWithSignal } from "../../../core/utils/leased-semaphore";
import { fetchHonouringRetryAfter } from "./throttle-retry";
import {
  buildCalendarObjectFilters,
  CALDAV_MULTIGET_BATCH_SIZE,
  isCalendarObjectPath,
} from "./api";
import { createDigestAwareFetch } from "./digest-fetch";
import { runInRequestScope } from "./response-status-scope";
import { findCalendarByStoredUrl } from "./calendar-identity";
import { discoverCalendarCollections, supportsEvents } from "./calendar-discovery";
import { resolveCollectionTimeZone } from "./collection-timezone";
import { CURRENT_USER_PRIVILEGE_SET_PROP, readCurrentUserPrivileges } from "./privileges";
import { isCalDAVPrivilegeSetWritable } from "../../../core/source/calendar-capabilities";
import type { CalDAVAuthMethod } from "./digest-fetch";
import type { SafeFetchOptions, WithheldCredentials } from "../../../utils/safe-fetch";
import type { CalDAVClientConfig, CalendarInfo } from "../types";
import { measureProviderRequest } from "../../../core/telemetry/segments";
import { fetchMultiGetBatch } from "./multiget";

const MISSING_HREF_SAMPLE_SIZE = 5;

const CALENDAR_DISCOVERY_PROPS = {
  "c:calendar-description": {},
  "c:calendar-timezone": {},
  "c:calendar-timezone-id": {},
  "d:displayname": {},
  "ca:calendar-color": {},
  "cs:getctag": {},
  "d:resourcetype": {},
  "c:supported-calendar-component-set": {},
  "d:sync-token": {},
  [CURRENT_USER_PRIVILEGE_SET_PROP]: {},
};

interface ResolvedCalendar {
  url: string;
  timeZone?: string;
}

interface CalendarObject {
  url: string;
  etag?: string;
  data?: string;
}

interface CalDAVListingStats {
  listedCount: number;
  requestedCount: number;
  returnedCount: number;
  unrequestedCount: number;
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

type CalDAVWriteOperation = "create" | "delete" | "update";

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

const isPrivilegeSetWritable = (privilegeSet: unknown): boolean =>
  isCalDAVPrivilegeSetWritable(readCurrentUserPrivileges(privilegeSet));

const getDisplayName = (name: unknown): string => {
  if (typeof name === "string") {
    return name;
  }
  return "Unnamed Calendar";
};

const bindUrlToAccount = (url: string, serverUrl: string): string => {
  const target = new URL(url, serverUrl);
  const bound = new URL(serverUrl);
  if (target.origin === bound.origin) {
    return target.href;
  }

  bound.pathname = target.pathname;
  bound.search = target.search;
  return bound.href;
};

const bindRequestToAccount = (input: string | Request | URL, serverUrl: string): string | Request => {
  if (input instanceof Request) {
    const bound = bindUrlToAccount(input.url, serverUrl);
    if (bound === input.url) {
      return input;
    }
    return new Request(bound, input);
  }

  return bindUrlToAccount(input.toString(), serverUrl);
};

const toCalendarObjectPath = (href: string, calendarUrl: string): string =>
  new URL(href, calendarUrl).pathname;

const isCalendarObjectUrlOf = (calendarUrl: string) => (url: string): boolean =>
  isCalendarObjectPath(toCalendarObjectPath(url, calendarUrl));

const toCalendarObjectPaths = (responses: { href?: string }[], calendarUrl: string): string[] => [
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

  private async chargeRequest(): Promise<void> {
    await this.config.onBeforeRequest?.();
  }

  private async getClient(): Promise<DAVClientInstance> {
    if (!this.client) {
      const safeFetch = createSafeFetch(this.safeFetchOptions);
      const chargedFetch: typeof safeFetch = (input, init) => fetchHonouringRetryAfter(
        async (attempt) => {
          await this.chargeRequest();
          return safeFetch(attempt, init);
        },
        input,
        { signal: init?.signal, sleep: sleepWithSignal },
      );
      const { fetch: digestAwareFetch, getResolvedMethod } = createDigestAwareFetch({
        credentials: this.config.credentials,
        baseFetch: chargedFetch,
        knownAuthMethod: this.config.authMethod,
      });
      this.resolvedAuthMethod = getResolvedMethod;
      const { serverUrl } = this.config;
      const accountBoundFetch = (input: string | Request | URL, init?: RequestInit): Promise<Response> =>
        digestAwareFetch(bindRequestToAccount(input, serverUrl), init);
      this.client = await createDAVClient({
        authMethod: "Custom",
        authFunction: () => Promise.resolve({}),
        credentials: this.config.credentials,
        fetch: accountBoundFetch,
        serverUrl,
      });
    }
    return this.client;
  }

  async discoverCalendars(): Promise<CalendarInfo[]> {
    const cached = await this.config.calendarDiscoveryCache?.read();
    if (cached) {
      return cached;
    }

    const calendars = await mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      return discoverCalendarCollections(
        (request) => measureProviderRequest(() => client.propfind(request)),
        this.config.serverUrl,
        CALENDAR_DISCOVERY_PROPS,
      );
    });

    const discovered = calendars
      .filter((calendar) => supportsEvents(calendar))
      .map(({ url, displayName, ctag, props }): CalendarInfo => {
        const timeZone = resolveCollectionTimeZone(props);
        return {
          ctag,
          displayName: getDisplayName(displayName),
          ...timeZone && { timeZone },
          url: bindUrlToAccount(url, this.config.serverUrl),
          writable: isPrivilegeSetWritable(props["currentUserPrivilegeSet"]),
        };
      });

    await this.config.calendarDiscoveryCache?.write(discovered);
    return discovered;
  }

  async fetchCalendarWritable(calendarUrl: string): Promise<boolean> {
    const [response] = await mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      return measureProviderRequest(() => client.propfind({
        depth: "0",
        props: { [CURRENT_USER_PRIVILEGE_SET_PROP]: {} },
        url: bindUrlToAccount(calendarUrl, this.config.serverUrl),
      }));
    });
    return isPrivilegeSetWritable(response?.props?.["currentUserPrivilegeSet"]);
  }

  async fetchCalendarDisplayName(calendarUrl: string): Promise<string | null> {
    const calendars = await this.discoverCalendars();

    return findCalendarByStoredUrl(calendars, calendarUrl)?.displayName ?? null;
  }

  async resolveCalendar(storedUrl: string): Promise<ResolvedCalendar> {
    const calendars = await this.discoverCalendars();
    const calendar = findCalendarByStoredUrl(calendars, storedUrl);
    if (!calendar) {
      return { url: storedUrl };
    }

    return {
      ...calendar.timeZone && { timeZone: calendar.timeZone },
      url: calendar.url,
    };
  }

  async resolveCalendarUrl(storedUrl: string): Promise<string> {
    const { url } = await this.resolveCalendar(storedUrl);
    return url;
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
    await this.deleteCalendarObjectByUrl({
      etag: params.etag,
      objectUrl: CalDAVClient.normalizeUrl(params.calendarUrl, params.filename),
    });
  }

  async updateCalendarObjectByUrl(params: {
    objectUrl: string;
    iCalString: string;
  }): Promise<void> {
    const client = await this.getClient();

    const response = await client.updateCalendarObject({
      calendarObject: { data: params.iCalString, url: params.objectUrl },
    });

    await assertSuccessfulResponse(response, "update");
  }

  async deleteCalendarObjectByUrl(params: {
    objectUrl: string;
    etag?: string;
  }): Promise<void> {
    const client = await this.getClient();

    const response = await client.deleteCalendarObject({
      calendarObject: { url: params.objectUrl, etag: params.etag },
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
      const objects = await fetchMultiGetBatch(client, {
        calendarUrl: params.calendarUrl,
        objectUrls: [objectUrl],
        urlFilter: isCalendarObjectUrlOf(params.calendarUrl),
      });

      return objects.find((object): object is CalendarObject => typeof object.data === "string") ?? null;
    });
  }

  /*
   * A multiget omits hrefs the calendar no longer holds. For a named lookup that omission
   * is the answer, so — unlike the windowed listing — it is not an incompleteness error.
   */
  fetchCalendarObjectsByUrls(params: {
    calendarUrl: string;
    objectUrls: string[];
  }): Promise<CalendarObject[]> {
    return mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      const objects: CalendarObject[] = [];

      for (const objectUrls of chunkArray(params.objectUrls, CALDAV_MULTIGET_BATCH_SIZE)) {
        const batch = await measureProviderRequest(() => fetchMultiGetBatch(client, {
          calendarUrl: params.calendarUrl,
          objectUrls,
          urlFilter: isCalendarObjectUrlOf(params.calendarUrl),
        }));
        objects.push(
          ...batch.filter((object): object is CalendarObject => typeof object.data === "string"),
        );
      }

      return objects;
    });
  }

  fetchCalendarObjects(params: {
    calendarUrl: string;
    onListing?: (stats: CalDAVListingStats) => void;
    pathFilter?: (path: string) => boolean;
    timeRange?: { start: string; end: string };
  }): Promise<CalendarObject[]> {
    return mapAuthenticationFailure(async () => {
      const client = await this.getClient();

      const queryResponses = await measureProviderRequest(() => client.calendarQuery({
        depth: "1",
        filters: buildCalendarObjectFilters(params.timeRange),
        props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
        url: params.calendarUrl,
      }));

      const listedPaths = toCalendarObjectPaths(queryResponses, params.calendarUrl);
      const requestedPaths = listedPaths.filter((path) => params.pathFilter?.(path) ?? true);
      if (requestedPaths.length === 0) {
        params.onListing?.({
          listedCount: listedPaths.length,
          requestedCount: 0,
          returnedCount: 0,
          unrequestedCount: 0,
        });
        return [];
      }

      const batches = chunkArray(requestedPaths, CALDAV_MULTIGET_BATCH_SIZE);
      const batchResults: CalendarObject[][] = [];

      for (const objectUrls of batches) {
        const objects = await measureProviderRequest(() => fetchMultiGetBatch(client, {
          calendarUrl: params.calendarUrl,
          objectUrls,
          urlFilter: isCalendarObjectUrlOf(params.calendarUrl),
        }));
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
      const requestedPathSet = new Set(requestedPaths);
      params.onListing?.({
        listedCount: listedPaths.length,
        requestedCount: batches.reduce((total, batch) => total + batch.length, 0),
        returnedCount: requestedPaths.length - missingHrefs.length,
        unrequestedCount: [...objectsByPath.keys()].filter((path) => !requestedPathSet.has(path)).length,
      });

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
export type { CalDAVListingStats };

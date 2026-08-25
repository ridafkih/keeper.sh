import { HTTP_STATUS } from "@keeper.sh/constants";
import { createDAVClient, DAVNamespace, DAVNamespaceShort, getDAVAttribute } from "tsdav";
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
import type { CalDAVAuthMethod } from "./digest-fetch";
import type { SafeFetchOptions, WithheldCredentials } from "../../../utils/safe-fetch";
import type { CalDAVClientConfig, CalendarInfo } from "../types";
import { measureProviderRequest } from "../../../core/telemetry/segments";

const MISSING_HREF_SAMPLE_SIZE = 5;

interface CalendarObject {
  url: string;
  etag?: string;
  data?: string;
}

type CalDAVObjectPresence = "absent" | "present" | "unknown";

/* What the server actually said about one requested href. Only its own 404 is absence; every other
   answer, and every href it declined to answer, stays unknown. */
interface CalDAVObjectAnswer {
  data: string | null;
  path: string;
  presence: CalDAVObjectPresence;
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

const toCalendarObjectPaths = (responses: { href?: string }[], calendarUrl: string): string[] => [
  ...new Set(
    responses
      .map(({ href }) => toCalendarObjectPath(href ?? "", calendarUrl))
      .filter((path) => isCalendarObjectPath(path)),
  ),
];

const DAV_STATUS_PATTERN = /^\S+\s(?<code>\d{3})\s/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toStatusCode = (status: unknown): number | null => {
  if (typeof status !== "string") {
    return null;
  }
  const code = DAV_STATUS_PATTERN.exec(status)?.groups?.code;
  if (!code) {
    return null;
  }
  return Number.parseInt(code, 10);
};

/* One child element arrives as an object and a repeat arrives as an array, so both shapes are
   read the same way. */
const toElementList = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((entry) => isRecord(entry));
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
};

const readPropStatProp = (propstat: Record<string, unknown>): Record<string, unknown> | null => {
  if (!isRecord(propstat.prop)) {
    return null;
  }
  return propstat.prop;
};

const readCalendarData = (response: Record<string, unknown>): string | null => {
  for (const propstat of toElementList(response.propstat)) {
    const prop = readPropStatProp(propstat);
    if (prop && typeof prop.calendarData === "string") {
      return prop.calendarData;
    }
  }
  return null;
};

/* Inside a propstat the status describes the property, not the resource (RFC 4918 13.9), so a 404
   filed over calendar-data alongside a propstat the server answered is a withheld body, not a gone
   object. Absence is a 404 spoken about the href itself: the response-wide status, or propstats
   that all say 404 and so leave the server claiming nothing about this href. */
const isHrefNotFound = (response: Record<string, unknown>): boolean => {
  const responseStatus = toStatusCode(response.status);
  if (responseStatus !== null) {
    return responseStatus === HTTP_STATUS.NOT_FOUND;
  }

  const propstatStatuses = toElementList(response.propstat).map((propstat) =>
    toStatusCode(propstat.status));
  if (propstatStatuses.length === 0) {
    return false;
  }
  return propstatStatuses.every((status) => status === HTTP_STATUS.NOT_FOUND);
};

const toObjectAnswerKey = (href: string, calendarUrl: string): string => {
  const path = toCalendarObjectPath(href, calendarUrl);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const toObjectAnswer = (
  response: Record<string, unknown>,
  calendarUrl: string,
): CalDAVObjectAnswer | null => {
  const { href } = response;
  if (typeof href !== "string" || href.length === 0) {
    return null;
  }

  const path = toCalendarObjectPath(href, calendarUrl);
  const data = readCalendarData(response);
  if (data !== null) {
    return { data, path, presence: "present" };
  }
  if (isHrefNotFound(response)) {
    return { data: null, path, presence: "absent" };
  }
  return { data: null, path, presence: "unknown" };
};

/* The tsdav calendarMultiGet routes through collectionQuery, which throws as soon as any href
   answers 4xx — the very answer that proves that href absent. Issuing the REPORT ourselves keeps
   every href's own status intact. */
const buildMultiGetBody = (objectUrls: string[]): Record<string, unknown> => ({
  "calendar-multiget": {
    _attributes: getDAVAttribute([DAVNamespace.DAV, DAVNamespace.CALDAV]),
    [`${DAVNamespaceShort.DAV}:prop`]: {
      [`${DAVNamespaceShort.DAV}:getetag`]: {},
      [`${DAVNamespaceShort.CALDAV}:calendar-data`]: {},
    },
    [`${DAVNamespaceShort.DAV}:href`]: objectUrls,
  },
});

/* The tsdav mapping folds every propstat of an href into one prop bag and keeps only a
   response-wide status, erasing "gone" versus "refused". The raw multistatus still holds it. */
const toMultiStatusResponses = (responses: { raw?: unknown }[]): Record<string, unknown>[] => {
  const raw = responses[0]?.raw;
  if (!isRecord(raw) || !isRecord(raw.multistatus)) {
    return [];
  }
  return toElementList(raw.multistatus.response);
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
        defaultAccountType: "caldav",
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
      return measureProviderRequest(() => client.fetchCalendars());
    });

    const discovered = calendars
      .filter(({ components }) => components?.includes("VEVENT"))
      .map(({ url, displayName, ctag }) => ({
        ctag,
        displayName: getDisplayName(displayName),
        url: bindUrlToAccount(url, this.config.serverUrl),
      }));

    await this.config.calendarDiscoveryCache?.write(discovered);
    return discovered;
  }

  async fetchCalendarDisplayName(calendarUrl: string): Promise<string | null> {
    const calendars = await this.discoverCalendars();

    return findCalendarByStoredUrl(calendars, calendarUrl)?.displayName ?? null;
  }

  async resolveCalendarUrl(storedUrl: string): Promise<string> {
    const calendars = await this.discoverCalendars();

    return findCalendarByStoredUrl(calendars, storedUrl)?.url ?? storedUrl;
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
      const objects = await client.fetchCalendarObjects({
        calendar: { url: params.calendarUrl },
        objectUrls: [objectUrl],
      });

      return objects[0] ?? null;
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
        const batch = await measureProviderRequest(() => client.fetchCalendarObjects({
          calendar: { url: params.calendarUrl },
          objectUrls,
          urlFilter: (url) => isCalendarObjectPath(toCalendarObjectPath(url, params.calendarUrl)),
        }));
        objects.push(
          ...batch.filter((object): object is CalendarObject => typeof object.data === "string"),
        );
      }

      return objects;
    });
  }

  /*
   * Absence must come from the server's own words about that href: a 404 for it. An answer that
   * refuses, withholds calendar-data, or never arrives at all leaves the object unknown, so a
   * truncated multiget can never be read as the calendar no longer holding what it did not answer.
   */
  verifyCalendarObjectsByUrls(params: {
    calendarUrl: string;
    objectUrls: string[];
  }): Promise<CalDAVObjectAnswer[]> {
    return mapAuthenticationFailure(async () => {
      const client = await this.getClient();
      const answersByKey = new Map<string, CalDAVObjectAnswer>();

      for (const objectUrls of chunkArray(params.objectUrls, CALDAV_MULTIGET_BATCH_SIZE)) {
        const responses = await measureProviderRequest(() => client.davRequest({
          init: {
            body: buildMultiGetBody(objectUrls),
            headers: { depth: "1" },
            method: "REPORT",
            namespace: DAVNamespaceShort.CALDAV,
          },
          url: params.calendarUrl,
        }));

        for (const response of toMultiStatusResponses(responses)) {
          const answer = toObjectAnswer(response, params.calendarUrl);
          if (answer) {
            answersByKey.set(toObjectAnswerKey(answer.path, params.calendarUrl), answer);
          }
        }
      }

      return params.objectUrls.map((objectUrl) => {
        const path = toCalendarObjectPath(objectUrl, params.calendarUrl);
        const answered = answersByKey.get(toObjectAnswerKey(objectUrl, params.calendarUrl));
        return answered ?? { data: null, path, presence: "unknown" };
      });
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
        const objects = await measureProviderRequest(() => client.fetchCalendarObjects({
          calendar: { url: params.calendarUrl },
          objectUrls,
          urlFilter: (url) => isCalendarObjectPath(toCalendarObjectPath(url, params.calendarUrl)),
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
export type { CalDAVListingStats, CalDAVObjectAnswer, CalendarObject };

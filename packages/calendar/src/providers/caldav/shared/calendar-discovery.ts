import { DAVNamespaceShort } from "tsdav";
import type { DAVResponse } from "tsdav";

const WELL_KNOWN_CALDAV_PATH = "/.well-known/caldav";
const EVENT_COMPONENT = "VEVENT";
const HTTP_UNAUTHORIZED = 401;

type PropfindDepth = "0" | "1";

type Propfind = (request: {
  depth: PropfindDepth;
  props: Record<string, unknown>;
  url: string;
}) => Promise<DAVResponse[]>;

type DiscoveredProps = Record<string, unknown>;

interface DiscoveredCollection {
  components: string[] | null;
  ctag?: string;
  displayName: unknown;
  props: DiscoveredProps;
  url: string;
}

interface DiscoveryContext {
  calendarHomeUrls: string[];
  isCalendar: boolean;
  kind: "answered";
  principalUrl: string | null;
}

type ContextAnswer = DiscoveryContext | { kind: "refused" } | { kind: "unanswered" };

class CalDAVDiscoveryError extends Error {
  constructor() {
    super("No calendar home or calendar collection found at the entered URL or its well-known URI");
    this.name = "CalDAVDiscoveryError";
  }
}

const CONTEXT_PROPS = {
  [`${DAVNamespaceShort.CALDAV}:calendar-home-set`]: {},
  [`${DAVNamespaceShort.DAV}:current-user-principal`]: {},
  [`${DAVNamespaceShort.DAV}:resourcetype`]: {},
};

const CALENDAR_HOME_SET_PROPS = {
  [`${DAVNamespaceShort.CALDAV}:calendar-home-set`]: {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toList = (value: unknown): unknown[] => {
  if (value === null || value === globalThis.undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
};

const toText = (value: unknown): string | undefined => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return globalThis.undefined;
};

const resolveHref = (href: unknown, baseUrl: string): string | null => {
  const text = toText(href);
  if (!text) {
    return null;
  }
  return new URL(text, baseUrl).href;
};

const readHrefs = (property: unknown, baseUrl: string): string[] => {
  if (!isRecord(property)) {
    return [];
  }
  return toList(property["href"]).flatMap((href) => resolveHref(href, baseUrl) ?? []);
};

const readResourceTypes = (props: DiscoveredProps): string[] => {
  const { resourcetype } = props;
  if (!isRecord(resourcetype)) {
    return [];
  }
  return Object.keys(resourcetype);
};

const readComponentName = (comp: unknown): string | null => {
  if (!isRecord(comp) || !isRecord(comp["_attributes"])) {
    return null;
  }
  return toText(comp["_attributes"]["name"]) ?? null;
};

const readSupportedComponents = (props: DiscoveredProps): string[] | null => {
  const { supportedCalendarComponentSet } = props;
  if (!isRecord(supportedCalendarComponentSet) || !("comp" in supportedCalendarComponentSet)) {
    return null;
  }
  return toList(supportedCalendarComponentSet["comp"]).flatMap((comp) => readComponentName(comp) ?? []);
};

const readDisplayName = (displayname: unknown): unknown => {
  if (isRecord(displayname) && "_cdata" in displayname) {
    return displayname["_cdata"];
  }
  if (typeof displayname === "number") {
    return String(displayname);
  }
  return displayname;
};

const answeredResponses = (responses: DAVResponse[]): (DAVResponse & { href: string; props: DiscoveredProps })[] =>
  responses.filter(
    (response): response is DAVResponse & { href: string; props: DiscoveredProps } =>
      response.ok && typeof response.href === "string" && isRecord(response.props),
  );

const supportsEvents = ({ components }: { components: string[] | null }): boolean =>
  components === null || components.includes(EVENT_COMPONENT);

const toCollection = (href: string, props: DiscoveredProps, baseUrl: string): DiscoveredCollection => ({
  components: readSupportedComponents(props),
  ctag: toText(props["getctag"]),
  displayName: readDisplayName(props["displayname"]),
  props,
  url: new URL(href, baseUrl).href,
});

const refusedCredentials = (responses: DAVResponse[]): boolean =>
  responses.some(({ status }) => status === HTTP_UNAUTHORIZED);

const readContext = async (propfind: Propfind, contextUrl: string): Promise<ContextAnswer> => {
  const responses = await propfind({ depth: "0", props: CONTEXT_PROPS, url: contextUrl });
  if (refusedCredentials(responses)) {
    return { kind: "refused" };
  }

  const [answer] = answeredResponses(responses);
  if (!answer) {
    return { kind: "unanswered" };
  }

  const [principalUrl] = readHrefs(answer.props["currentUserPrincipal"], contextUrl);
  return {
    calendarHomeUrls: readHrefs(answer.props["calendarHomeSet"], contextUrl),
    isCalendar: readResourceTypes(answer.props).includes("calendar"),
    kind: "answered",
    principalUrl: principalUrl ?? null,
  };
};

const readCalendarHomeUrls = async (propfind: Propfind, principalUrl: string): Promise<string[]> => {
  const responses = await propfind({ depth: "0", props: CALENDAR_HOME_SET_PROPS, url: principalUrl });
  return answeredResponses(responses).flatMap(({ props }) => readHrefs(props["calendarHomeSet"], principalUrl));
};

const resolveCalendarHomeUrls = (propfind: Propfind, context: DiscoveryContext): Promise<string[]> => {
  if (context.calendarHomeUrls.length > 0 || !context.principalUrl) {
    return Promise.resolve(context.calendarHomeUrls);
  }
  return readCalendarHomeUrls(propfind, context.principalUrl);
};

const listCalendarCollections = async (
  propfind: Propfind,
  collectionUrl: string,
  depth: PropfindDepth,
  props: Record<string, unknown>,
): Promise<DiscoveredCollection[]> => {
  const responses = await propfind({ depth, props, url: collectionUrl });
  return answeredResponses(responses)
    .filter((response) => readResourceTypes(response.props).includes("calendar"))
    .map((response) => toCollection(response.href, response.props, collectionUrl));
};

const uniqueByUrl = (collections: DiscoveredCollection[]): DiscoveredCollection[] => [
  ...new Map(collections.map((collection) => [collection.url, collection])).values(),
];

const discoveryContextUrls = (serverUrl: string): string[] => [
  ...new Set([new URL(serverUrl).href, new URL(WELL_KNOWN_CALDAV_PATH, serverUrl).href]),
];

const listCalendarHomes = async (
  propfind: Propfind,
  homeUrls: string[],
  listingProps: Record<string, unknown>,
): Promise<DiscoveredCollection[]> => {
  const listed: DiscoveredCollection[] = [];
  for (const homeUrl of homeUrls) {
    listed.push(...await listCalendarCollections(propfind, homeUrl, "1", listingProps));
  }
  return listed;
};

const discoverCalendarCollections = async (
  propfind: Propfind,
  serverUrl: string,
  listingProps: Record<string, unknown>,
): Promise<DiscoveredCollection[]> => {
  const contextCalendars: DiscoveredCollection[] = [];

  for (const contextUrl of discoveryContextUrls(serverUrl)) {
    const context = await readContext(propfind, contextUrl);
    if (context.kind === "refused") {
      break;
    }
    if (context.kind === "unanswered") {
      continue;
    }

    if (context.isCalendar) {
      contextCalendars.push(...await listCalendarCollections(propfind, contextUrl, "0", listingProps));
    }

    const homeUrls = await resolveCalendarHomeUrls(propfind, context);
    if (homeUrls.length > 0) {
      const listed = await listCalendarHomes(propfind, homeUrls, listingProps);
      return uniqueByUrl([...listed, ...contextCalendars]);
    }
  }

  if (contextCalendars.length > 0) {
    return uniqueByUrl(contextCalendars);
  }

  throw new CalDAVDiscoveryError();
};

export { CalDAVDiscoveryError, discoverCalendarCollections, supportsEvents };

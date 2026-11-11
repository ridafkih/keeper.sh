import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import { createCalendarDiscoveryCache } from "../../../../src/providers/caldav/shared/discovery-cache";

const HOST = "caldav.example.test";
const FOREIGN_HOST = "elsewhere.example.test";
const SERVER_URL = `https://${HOST}`;
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const BERLIN_VCALENDAR = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Collection Zone//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  "END:VCALENDAR",
].join("\r\n");

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");

const DEFAULT_DISCOVERY_PROPS = [
  "calendar-description",
  "calendar-timezone",
  "displayname",
  "calendar-color",
  "getctag",
  "resourcetype",
  "supported-calendar-component-set",
  "sync-token",
];

interface CollectionFixture {
  href: string;
  displayName: string;
  zoneProps: string;
  missingProps?: string;
}

const COLLECTIONS: CollectionFixture[] = [
  {
    displayName: "Cdata",
    href: `${HOME_PATH}cdata/`,
    zoneProps: `<c:calendar-timezone><![CDATA[${BERLIN_VCALENDAR}]]></c:calendar-timezone>`,
  },
  {
    displayName: "Entity",
    href: `${HOME_PATH}entity/`,
    zoneProps: `<c:calendar-timezone>${escapeXml(BERLIN_VCALENDAR)}</c:calendar-timezone>`,
  },
  {
    displayName: "Identifier",
    href: `${HOME_PATH}identifier/`,
    missingProps: "<c:calendar-timezone/>",
    zoneProps: "<c:calendar-timezone-id>Asia/Manila</c:calendar-timezone-id>",
  },
  {
    displayName: "Neither",
    href: `${HOME_PATH}neither/`,
    missingProps: "<c:calendar-timezone/><c:calendar-timezone-id/>",
    zoneProps: "",
  },
  {
    displayName: "Foreign",
    href: `https://${FOREIGN_HOST}${HOME_PATH}foreign/`,
    zoneProps: "<c:calendar-timezone-id>Asia/Manila</c:calendar-timezone-id>",
  },
  {
    displayName: "Colored",
    href: `${HOME_PATH}colored/`,
    zoneProps: "<ca:calendar-color>#711A76FF</ca:calendar-color>",
  },
  {
    displayName: "SymbolicColor",
    href: `${HOME_PATH}symbolic-color/`,
    zoneProps: '<ca:calendar-color symbolic-color="custom">#33B679</ca:calendar-color>',
  },
];

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ca="http://apple.com/ns/ical/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const notFoundPropstat = (props: string | undefined): string => {
  if (!props) {
    return "";
  }
  return `<d:propstat><d:status>HTTP/1.1 404 Not Found</d:status><d:prop>${props}</d:prop></d:propstat>`;
};

const collectionResponse = ({ displayName, href, missingProps, zoneProps }: CollectionFixture): string => {
  const found = `<d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${displayName}</d:displayname><cs:getctag>ctag-${displayName}</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>${zoneProps}</d:prop></d:propstat>`;
  return `<d:response><d:href>${href}</d:href>${found}${notFoundPropstat(missingProps)}</d:response>`;
};

const contentFor = (url: URL): Response => {
  if (url.pathname === "/.well-known/caldav") {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
  if (url.pathname === "/") {
    return multistatus(
      `<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
    );
  }
  if (url.pathname === PRINCIPAL_PATH) {
    return multistatus(
      `<d:response><d:href>${PRINCIPAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
    );
  }
  if (url.pathname === HOME_PATH) {
    return multistatus(COLLECTIONS.map((collection) => collectionResponse(collection)).join(""));
  }
  return multistatus(
    `<d:response><d:href>${url.pathname}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );
};

interface RecordedRequest {
  body: string;
  depth: string | null;
  method: string;
  url: URL;
}

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const readBody = (body: RequestInit["body"]): string => {
  if (typeof body === "string") {
    return body;
  }
  return "";
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let requestLog: RecordedRequest[] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  requestLog = [];
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    requestLog.push({
      body: readBody(init?.body),
      depth: new Headers(init?.headers).get("depth"),
      method: init?.method ?? "GET",
      url,
    });
    await Promise.resolve();
    return contentFor(url);
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    setex: (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    },
  };
};

const createClient = (redis?: ReturnType<typeof fakeRedis>): CalDAVClient =>
  new CalDAVClient({
    ...redis && { calendarDiscoveryCache: createCalendarDiscoveryCache(redis, "account-1") },
    credentials: { password: "example-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

const calendarAt = (calendars: { url: string }[], path: string) =>
  calendars.find(({ url }) => new URL(url).pathname === path);

const homeSetPropfinds = (): RecordedRequest[] =>
  requestLog.filter(({ method, url }) => method === "PROPFIND" && url.pathname === HOME_PATH);

describe("CalDAV discovery reads the collection color", () => {
  it("normalizes a calendar-color with an alpha channel", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}colored/`)).toMatchObject({ color: "#711a76" });
  });

  it("reads a calendar-color carrying attributes", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}symbolic-color/`)).toMatchObject({ color: "#33b679" });
  });

  it("leaves the color out of a collection that reports none", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}neither/`)).not.toHaveProperty("color");
  });
});

describe("CalDAV discovery reads the collection time zone", () => {
  it("resolves a calendar-timezone VTIMEZONE delivered as CDATA", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}cdata/`)).toMatchObject({ timeZone: "Europe/Berlin" });
  });

  it("resolves a calendar-timezone VTIMEZONE delivered as entity-encoded text", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}entity/`)).toMatchObject({ timeZone: "Europe/Berlin" });
  });

  it("resolves calendar-timezone-id when calendar-timezone is missing", async () => {
    const calendars = await createClient().discoverCalendars();

    expect(calendarAt(calendars, `${HOME_PATH}identifier/`)).toMatchObject({ timeZone: "Asia/Manila" });
  });

  it("leaves the zone out when both properties come back as a 404 propstat", async () => {
    const calendars = await createClient().discoverCalendars();
    const neither = calendarAt(calendars, `${HOME_PATH}neither/`);

    expect(neither).toMatchObject({ displayName: "Neither" });
    expect(neither).not.toHaveProperty("timeZone");
  });

  it("keeps the zone on the account-bound url of a calendar named under a foreign origin", async () => {
    const calendars = await createClient().discoverCalendars();
    const foreign = calendarAt(calendars, `${HOME_PATH}foreign/`);

    expect(foreign).toEqual({
      ctag: "ctag-Foreign",
      displayName: "Foreign",
      timeZone: "Asia/Manila",
      url: `${SERVER_URL}${HOME_PATH}foreign/`,
      writable: true,
    });
  });

  it("asks for calendar-timezone-id alongside every property tsdav asks for by default", async () => {
    await createClient().discoverCalendars();
    const [discovery] = homeSetPropfinds();

    expect(discovery?.depth).toBe("1");
    for (const prop of [...DEFAULT_DISCOVERY_PROPS, "calendar-timezone-id"]) {
      expect(discovery?.body).toMatch(new RegExp(`:${prop}\\b(?!-)`));
    }
  });

  it("reads the zone within the single discovery PROPFIND to the calendar home", async () => {
    await createClient().discoverCalendars();

    expect(homeSetPropfinds()).toHaveLength(1);
  });

  it("sends no request when the walk is answered from the discovery cache", async () => {
    const redis = fakeRedis();
    await createClient(redis).discoverCalendars();
    requestLog = [];

    const calendars = await createClient(redis).discoverCalendars();

    expect(requestLog).toEqual([]);
    expect(calendarAt(calendars, `${HOME_PATH}cdata/`)).toMatchObject({ timeZone: "Europe/Berlin" });
    expect(calendarAt(calendars, `${HOME_PATH}identifier/`)).toMatchObject({ timeZone: "Asia/Manila" });
  });
});

describe("CalDAVClient.resolveCalendar", () => {
  it("returns the discovered url with its collection zone", async () => {
    const resolved = await createClient().resolveCalendar(`${SERVER_URL}${HOME_PATH}identifier/`);

    expect(resolved).toEqual({ timeZone: "Asia/Manila", url: `${SERVER_URL}${HOME_PATH}identifier/` });
  });

  it("returns the discovered url without a zone when the collection declares none", async () => {
    const resolved = await createClient().resolveCalendar(`${SERVER_URL}${HOME_PATH}neither/`);

    expect(resolved).toEqual({ url: `${SERVER_URL}${HOME_PATH}neither/` });
  });

  it("falls back to the stored url when discovery does not list it", async () => {
    const storedUrl = `${SERVER_URL}${HOME_PATH}removed/`;

    await expect(createClient().resolveCalendar(storedUrl)).resolves.toEqual({ url: storedUrl });
  });

  it("keeps resolveCalendarUrl answering with the url alone", async () => {
    const storedUrl = `${SERVER_URL}${HOME_PATH}cdata/`;

    await expect(createClient().resolveCalendarUrl(storedUrl)).resolves.toBe(storedUrl);
  });
});

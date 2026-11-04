import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCalDAVSourceFetcher } from "../../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";
import { CalDAVUnreadableResourceError } from "../../../../src/providers/caldav/shared/ics";

const HOST = "caldav.example.test";
const SERVER_URL = `https://${HOST}`;
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const RESOURCE_NAME = "standup.ics";
const NOW = new Date("2026-11-01T12:00:00.000Z");

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

const COLLECTION_ZONE_PROPS: Record<string, { found: string; missing?: string }> = {
  cdata: { found: `<c:calendar-timezone><![CDATA[${BERLIN_VCALENDAR}]]></c:calendar-timezone>` },
  entity: { found: `<c:calendar-timezone>${escapeXml(BERLIN_VCALENDAR)}</c:calendar-timezone>` },
  identifier: {
    found: "<c:calendar-timezone-id>Asia/Manila</c:calendar-timezone-id>",
    missing: "<c:calendar-timezone/>",
  },
  neither: { found: "", missing: "<c:calendar-timezone/><c:calendar-timezone-id/>" },
};

const floatingResource = (calendarProperties: string[] = []): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example//Floating//EN",
    ...calendarProperties,
    "BEGIN:VEVENT",
    "UID:floating-standup@example.test",
    "DTSTAMP:20261101T000000Z",
    "DTSTART:20261110T090000",
    "DTEND:20261110T100000",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

let resource = floatingResource();

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const okPropstat = (props: string): string =>
  `<d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>${props}</d:prop></d:propstat>`;

const notFoundPropstat = (props: string | undefined): string => {
  if (!props) {
    return "";
  }
  return `<d:propstat><d:status>HTTP/1.1 404 Not Found</d:status><d:prop>${props}</d:prop></d:propstat>`;
};

const collectionResponse = (name: string): string => {
  const zone = COLLECTION_ZONE_PROPS[name];
  return `<d:response><d:href>${HOME_PATH}${name}/</d:href>${okPropstat(
    `<d:displayname>${name}</d:displayname><cs:getctag>ctag-${name}</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>${zone?.found ?? ""}`,
  )}${notFoundPropstat(zone?.missing)}</d:response>`;
};

const reportFor = (url: URL, body: string): Response => {
  const objectHref = `${url.pathname}${RESOURCE_NAME}`;
  if (body.includes("calendar-multiget")) {
    return multistatus(
      `<d:response><d:href>${objectHref}</d:href>${okPropstat(
        `<d:getetag>"etag-1"</d:getetag><c:calendar-data>${escapeXml(resource)}</c:calendar-data>`,
      )}</d:response>`,
    );
  }
  return multistatus(
    `<d:response><d:href>${objectHref}</d:href>${okPropstat('<d:getetag>"etag-1"</d:getetag>')}</d:response>`,
  );
};

const contentFor = (url: URL, method: string, body: string): Response => {
  if (url.pathname === "/.well-known/caldav") {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
  if (method === "REPORT") {
    return reportFor(url, body);
  }
  if (url.pathname === "/") {
    return multistatus(
      `<d:response><d:href>/</d:href>${okPropstat(
        `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`,
      )}</d:response>`,
    );
  }
  if (url.pathname === PRINCIPAL_PATH) {
    return multistatus(
      `<d:response><d:href>${PRINCIPAL_PATH}</d:href>${okPropstat(
        `<c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set>`,
      )}</d:response>`,
    );
  }
  if (url.pathname === HOME_PATH) {
    return multistatus(Object.keys(COLLECTION_ZONE_PROPS).map((name) => collectionResponse(name)).join(""));
  }
  return multistatus(
    `<d:response><d:href>${url.pathname}</d:href>${okPropstat("<d:supported-report-set/>")}</d:response>`,
  );
};

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

beforeEach(() => {
  originalFetch = globalThis.fetch;
  resource = floatingResource();
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    await Promise.resolve();
    return contentFor(requestUrl(input), init?.method ?? "GET", readBody(init?.body));
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fetchFrom = (collection: string) =>
  createCalDAVSourceFetcher({
    calendarUrl: `${SERVER_URL}${HOME_PATH}${collection}/`,
    password: "example-password",
    plan: createSourceIngestionPlan("1_month", "2_years", NOW),
    serverUrl: SERVER_URL,
    username: "user@example.test",
  }).fetchEvents();

const instantsOf = (events: { startTime: Date; endTime: Date }[]) =>
  events.map(({ endTime, startTime }) => ({
    end: endTime.toISOString(),
    start: startTime.toISOString(),
  }));

describe("a timed floating event in a CalDAV collection with a declared time zone", () => {
  it("ingests at the collection zone's instant when calendar-timezone arrives as CDATA", async () => {
    const result = await fetchFrom("cdata");

    expect(instantsOf(result.events)).toEqual([
      { end: "2026-11-10T09:00:00.000Z", start: "2026-11-10T08:00:00.000Z" },
    ]);
    expect(result.unsupportedEventUids).toBeUndefined();
  });

  it("ingests at the collection zone's instant when calendar-timezone arrives entity-encoded", async () => {
    const result = await fetchFrom("entity");

    expect(instantsOf(result.events)).toEqual([
      { end: "2026-11-10T09:00:00.000Z", start: "2026-11-10T08:00:00.000Z" },
    ]);
  });

  it("ingests at the collection zone's instant when only calendar-timezone-id is set", async () => {
    const result = await fetchFrom("identifier");

    expect(instantsOf(result.events)).toEqual([
      { end: "2026-11-10T02:00:00.000Z", start: "2026-11-10T01:00:00.000Z" },
    ]);
  });

  it("lets the resource's own X-WR-TIMEZONE win over the collection zone", async () => {
    resource = floatingResource(["X-WR-TIMEZONE:Asia/Manila"]);

    const result = await fetchFrom("cdata");

    expect(instantsOf(result.events)).toEqual([
      { end: "2026-11-10T02:00:00.000Z", start: "2026-11-10T01:00:00.000Z" },
    ]);
  });
});

describe("a timed floating event in a CalDAV collection with no declared time zone", () => {
  it("is still rejected as an unreadable resource instead of being placed in a guessed zone", async () => {
    await expect(fetchFrom("neither")).rejects.toBeInstanceOf(CalDAVUnreadableResourceError);
  });
});

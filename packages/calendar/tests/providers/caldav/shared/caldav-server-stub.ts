const SERVER_URL = "https://caldav.example.com";
const PRINCIPAL_PATH = "/p/u/";
const CALENDAR_HOME_PATH = "/cal/";
const CALENDAR_PATH = "/cal/u/";

const XML_HEADERS = { "content-type": "application/xml; charset=utf-8" };

interface RecordedRequest {
  body: string;
  method: string;
  url: string;
}

interface MultiGetRow {
  data?: string;
  etag?: string;
  href: string;
}

interface CalDAVServerStubOptions {
  queryHrefs: string[];
  respond?: (requestedHrefs: string[]) => MultiGetRow[];
}

interface CalDAVServerStub {
  calendarUrl: string;
  handle: (input: string | Request | URL, init?: RequestInit) => Promise<Response>;
  multigetBodies: () => string[];
  queryBodies: () => string[];
  requests: RecordedRequest[];
  serverUrl: string;
}

const hrefsIn = (body: string): string[] =>
  [...body.matchAll(/<(?:[a-z0-9]+:)?href>([^<]*)<\/(?:[a-z0-9]+:)?href>/gi)].map(
    (match) => match[1] ?? "",
  );

const xmlDocument = (inner: string): string =>
  `<?xml version="1.0" encoding="utf-8" ?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;

const xmlResponse = (inner: string): Response =>
  new Response(xmlDocument(inner), { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" });

const propResponse = (href: string, prop: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

const queryRow = (href: string): string =>
  propResponse(href, `<d:getetag>"etag-${href}"</d:getetag>`);

const multiGetRow = (row: MultiGetRow): string => {
  if (typeof row.data !== "string") {
    return `<d:response><d:href>${row.href}</d:href><d:propstat><d:prop><d:getetag/><c:calendar-data/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`;
  }
  return propResponse(
    row.href,
    `<d:getetag>"${row.etag ?? `etag-${row.href}`}"</d:getetag><c:calendar-data><![CDATA[${row.data}]]></c:calendar-data>`,
  );
};

const readBody = (init?: RequestInit): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

const readUrl = (input: string | Request | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const echoAllRequested = (requestedHrefs: string[]): MultiGetRow[] =>
  requestedHrefs.map((href) => ({ data: `BEGIN:VCALENDAR\r\nEND:VCALENDAR`, href }));

const createCalDAVServerStub = (options: CalDAVServerStubOptions): CalDAVServerStub => {
  const requests: RecordedRequest[] = [];
  const respond = options.respond ?? echoAllRequested;

  const handlePropfind = (url: string, body: string): Response => {
    if (body.includes("current-user-principal")) {
      return xmlResponse(propResponse(
        new URL(url).pathname,
        `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`,
      ));
    }
    if (body.includes("calendar-home-set")) {
      return xmlResponse(propResponse(
        new URL(url).pathname,
        `<c:calendar-home-set><d:href>${CALENDAR_HOME_PATH}</d:href></c:calendar-home-set>`,
      ));
    }
    return xmlResponse("");
  };

  const handleReport = (body: string): Response => {
    if (body.includes("calendar-multiget")) {
      return xmlResponse(respond(hrefsIn(body)).map((row) => multiGetRow(row)).join(""));
    }
    return xmlResponse(options.queryHrefs.map(queryRow).join(""));
  };

  const handle = (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = readUrl(input);
    const body = readBody(init);
    const method = init?.method ?? "GET";
    requests.push({ body, method, url });

    if (method === "PROPFIND") {
      return Promise.resolve(handlePropfind(url, body));
    }
    if (method === "REPORT") {
      return Promise.resolve(handleReport(body));
    }
    return Promise.resolve(new Response("", { headers: XML_HEADERS, status: 200 }));
  };

  const reportBodies = (marker: string): string[] =>
    requests
      .filter((request) => request.method === "REPORT" && request.body.includes(marker))
      .map((request) => request.body);

  return {
    calendarUrl: `${SERVER_URL}${CALENDAR_PATH}`,
    handle,
    multigetBodies: () => reportBodies("calendar-multiget"),
    queryBodies: () => reportBodies("calendar-query"),
    requests,
    serverUrl: SERVER_URL,
  };
};

export { CALENDAR_PATH, createCalDAVServerStub, hrefsIn, SERVER_URL };
export type { CalDAVServerStub, MultiGetRow };

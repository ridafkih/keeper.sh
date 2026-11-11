const ZOHO_REALM = 'Basic realm="Zoho Calendar CalDAVServer"';
const USER_HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const PRINCIPAL_PATH = `/caldav/${USER_HASH}/user/`;
const HOME_PATH = `/caldav/${USER_HASH}/`;
const PRIMARY_CALENDAR_PATH = `/caldav/${USER_HASH}/events/`;
const SECONDARY_CALENDAR_PATH = "/caldav/0f1e2d3c4b5a69788796a5b4c3d2e1f0/events/";

type WellKnownBehaviour = "answers-in-place" | "redirects-to-caldav";

interface FakeZohoOptions {
  password: string;
  username: string;
  wellKnown: WellKnownBehaviour;
}

interface RecordedZohoRequest {
  authorized: boolean;
  body: string;
  depth: string | null;
  method: string;
  path: string;
}

const multistatus = (responses: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?><D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`,
    { headers: { "content-type": "text/xml;charset=UTF-8" }, status: 207 },
  );

const emptyMultistatus = (): Response =>
  new Response(`<?xml version="1.0" encoding="UTF-8" standalone="no"?><D:multistatus xmlns:D="DAV:"/>`, {
    headers: { "content-type": "text/xml;charset=UTF-8" },
    status: 207,
  });

const unauthorized = (): Response =>
  new Response(null, {
    headers: { "content-type": "text/html;charset=UTF-8", "www-authenticate": ZOHO_REALM },
    status: 401,
  });

const notImplemented = (): Response => new Response(null, { status: 501 });

const notFound = (): Response => new Response(null, { status: 404 });

const okPropstat = (props: string): string =>
  `<D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;

const principalAnswer = (href: string): Response =>
  multistatus(
    `<D:response><D:href>${href}</D:href>${okPropstat(`<D:current-user-principal><D:href>${PRINCIPAL_PATH}</D:href></D:current-user-principal>`)}</D:response>`,
  );

const homeSetAnswer = (): Response =>
  multistatus(
    `<D:response><D:href>${PRINCIPAL_PATH}</D:href>${okPropstat(`<calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><D:href>${HOME_PATH}</D:href></calendar-home-set>`)}</D:response>`,
  );

const calendarResponse = (href: string, displayName: string, ctag: string): string =>
  `<D:response><D:href>${href}</D:href>${okPropstat(
    `<D:displayname>${displayName}</D:displayname><D:sync-token>${ctag}</D:sync-token><D:resourcetype><B:calendar xmlns:B="urn:ietf:params:xml:ns:caldav"/><D:collection/></D:resourcetype><getctag xmlns="http://calendarserver.org/ns/">${ctag}</getctag>`,
  )}</D:response>`;

const homeListing = (): Response =>
  multistatus(
    [
      `<D:response><D:href>${HOME_PATH}</D:href>${okPropstat(`<D:resourcetype><D:collection/><D:principal/></D:resourcetype><getctag xmlns="http://calendarserver.org/ns/">1770859408092</getctag>`)}</D:response>`,
      calendarResponse(PRIMARY_CALENDAR_PATH, "My Calendar", "1770859408092"),
      calendarResponse(SECONDARY_CALENDAR_PATH, "Work", "1770859408117"),
      `<D:response><D:href>/caldav/${USER_HASH}/inbox/</D:href>${okPropstat(`<D:resourcetype><D:collection/><B:schedule-inbox xmlns:B="urn:ietf:params:xml:ns:caldav"/></D:resourcetype><getctag xmlns="http://calendarserver.org/ns/">never-changes</getctag>`)}</D:response>`,
      `<D:response><D:href>/caldav/${USER_HASH}/outbox/</D:href>${okPropstat(`<D:resourcetype><B:schedule-outbox xmlns:B="urn:ietf:params:xml:ns:caldav"/><D:collection/></D:resourcetype><getctag xmlns="http://calendarserver.org/ns/">never-changes</getctag>`)}</D:response>`,
    ].join(""),
  );

const singleCalendar = (path: string): Response => {
  if (path === PRIMARY_CALENDAR_PATH) {
    return multistatus(calendarResponse(PRIMARY_CALENDAR_PATH, "My Calendar", "1770859408092"));
  }
  return multistatus(calendarResponse(SECONDARY_CALENDAR_PATH, "Work", "1770859408117"));
};

const isAuthorized = (authorization: string | null, options: FakeZohoOptions): boolean =>
  authorization === `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;

const PATHS_REFUSED_BEFORE_AUTHENTICATION = new Set(["/", "/caldav/", "/.well-known/caldav/"]);

const answerAuthorized = (request: RecordedZohoRequest, options: FakeZohoOptions): Response => {
  if (request.method !== "PROPFIND") {
    return notImplemented();
  }
  if (request.path === "/.well-known/caldav") {
    if (options.wellKnown === "redirects-to-caldav") {
      return new Response(null, { headers: { location: "https://calendar.zoho.com/caldav" }, status: 301 });
    }
    return principalAnswer("/.well-known/caldav");
  }
  if (request.path === "/caldav") {
    return principalAnswer("/caldav");
  }
  if (request.path === PRINCIPAL_PATH) {
    return homeSetAnswer();
  }
  if (request.path === PRINCIPAL_PATH.slice(0, -1)) {
    return emptyMultistatus();
  }
  if (request.path === HOME_PATH && request.depth === "1") {
    return homeListing();
  }
  if (request.path === PRIMARY_CALENDAR_PATH || request.path === SECONDARY_CALENDAR_PATH) {
    return singleCalendar(request.path);
  }
  return notFound();
};

const answerZoho = (request: RecordedZohoRequest, options: FakeZohoOptions): Response => {
  if (PATHS_REFUSED_BEFORE_AUTHENTICATION.has(request.path)) {
    return notImplemented();
  }
  if (!request.authorized) {
    return unauthorized();
  }
  return answerAuthorized(request, options);
};

const readHeader = (input: string | Request | URL, init: RequestInit | undefined, name: string): string | null => {
  const fromInit = new Headers(init?.headers).get(name);
  if (fromInit !== null) {
    return fromInit;
  }
  if (input instanceof Request) {
    return input.headers.get(name);
  }
  return null;
};

const readBody = (init: RequestInit | undefined): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

const readUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const createFakeZohoFetch = (options: FakeZohoOptions, recorded: RecordedZohoRequest[]): typeof globalThis.fetch =>
  ((input: string | Request | URL, init?: RequestInit) => {
    const request: RecordedZohoRequest = {
      authorized: isAuthorized(readHeader(input, init, "authorization"), options),
      body: readBody(init),
      depth: readHeader(input, init, "depth"),
      method: (init?.method ?? "GET").toUpperCase(),
      path: readUrl(input).pathname,
    };
    recorded.push(request);
    return Promise.resolve(answerZoho(request, options));
  }) as unknown as typeof globalThis.fetch;

export {
  createFakeZohoFetch,
  PRIMARY_CALENDAR_PATH,
  PRINCIPAL_PATH,
  SECONDARY_CALENDAR_PATH,
};
export type { FakeZohoOptions, RecordedZohoRequest, WellKnownBehaviour };

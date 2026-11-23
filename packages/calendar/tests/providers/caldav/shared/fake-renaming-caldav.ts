const RENAMING_SERVER_URL = "https://caldav.example.test";
const RENAMING_CALENDAR_PATH = "/users/someone/calendar/";
const RENAMING_CALENDAR_URL = `${RENAMING_SERVER_URL}${RENAMING_CALENDAR_PATH}`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

interface StoredObject {
  data: string;
  etag: string;
}

interface RecordedWrite {
  ifMatch: string | null;
  name: string;
}

interface RenamingCalDAVServerOptions {
  resolvesClientNames?: boolean;
  storeCreated?: (data: string) => string;
  storeUpdated?: (stored: string, data: string) => string;
}

interface RenamingCalDAVServer {
  fetch: typeof globalThis.fetch;
  names: () => string[];
  read: (name: string) => string | null;
  remove: (name: string) => void;
  seed: (data: string) => string;
  writes: RecordedWrite[];
}

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const okPropstat = (props: string): string =>
  `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;

const toHref = (name: string): string => `${RENAMING_CALENDAR_PATH}${encodeURIComponent(name)}`;

const toName = (path: string): string => decodeURIComponent(path.slice(RENAMING_CALENDAR_PATH.length));

const collectionResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${RENAMING_CALENDAR_PATH}</d:href>${okPropstat(
      `<d:displayname>Calendar</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
    )}</d:response>`,
  );

const listedObject = (name: string, object: StoredObject): string =>
  `<d:response><d:href>${toHref(name)}</d:href>${okPropstat(`<d:getetag>${object.etag}</d:getetag>`)}</d:response>`;

const returnedObject = (href: string, object: StoredObject): string =>
  `<d:response><d:href>${href}</d:href>${okPropstat(
    `<d:getetag>${object.etag}</d:getetag><c:calendar-data><![CDATA[${object.data}]]></c:calendar-data>`,
  )}</d:response>`;

const missingObject = (href: string): string =>
  `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;

const requestedHrefs = (body: string): string[] =>
  [...body.matchAll(/<[^>]*href[^>]*>(?<href>[^<]+)<\/[^>]*href>/giu)].map((match) => match.groups?.["href"] ?? "");

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

const keepAsSent = (data: string): string => data;

const createRenamingCalDAVServer = (options: RenamingCalDAVServerOptions = {}): RenamingCalDAVServer => {
  const storeCreated = options.storeCreated ?? keepAsSent;
  const storeUpdated = options.storeUpdated ?? ((_stored: string, data: string) => data);
  const objects = new Map<string, StoredObject>();
  const clientNames = new Map<string, string>();
  const writes: RecordedWrite[] = [];
  let stored = 0;

  const store = (data: string): string => {
    stored += 1;
    const name = `AAMkAGI2-${String(stored).padStart(4, "0")}_w==.EML`;
    objects.set(name, { data, etag: `"${String(stored)}"` });
    return name;
  };

  const resolveName = (name: string): string => {
    if (objects.has(name) || !options.resolvesClientNames) {
      return name;
    }
    return clientNames.get(name) ?? name;
  };

  const answerReport = (body: string): Response => {
    if (body.includes("calendar-multiget")) {
      return multistatus(requestedHrefs(body).map((href) => {
        const object = objects.get(resolveName(toName(new URL(href, RENAMING_SERVER_URL).pathname)));
        if (!object) {
          return missingObject(href);
        }
        return returnedObject(href, object);
      }).join(""));
    }
    return multistatus([...objects].map(([name, object]) => listedObject(name, object)).join(""));
  };

  const answerPut = (requestedName: string, data: string, ifMatch: string | null): Response => {
    const name = resolveName(requestedName);
    writes.push({ ifMatch, name });
    const existing = objects.get(name);
    if (ifMatch !== null && existing?.etag !== ifMatch) {
      return new Response(null, { status: 412 });
    }
    if (existing) {
      stored += 1;
      const etag = `"${String(stored)}"`;
      objects.set(name, { data: storeUpdated(existing.data, data), etag });
      return new Response(null, { headers: { etag, location: toHref(name) }, status: 204 });
    }
    const storedName = store(storeCreated(data));
    clientNames.set(requestedName, storedName);
    return new Response(null, {
      headers: { etag: objects.get(storedName)?.etag ?? "", location: toHref(storedName) },
      status: 201,
    });
  };

  const answerDelete = (name: string): Response => {
    if (!objects.delete(resolveName(name))) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 204 });
  };

  const answer = (input: string | Request | URL, init?: RequestInit): Response => {
    const { pathname } = readUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (!pathname.startsWith(RENAMING_CALENDAR_PATH)) {
      return new Response(null, { status: 404 });
    }
    if (method === "PROPFIND" && pathname === RENAMING_CALENDAR_PATH) {
      return collectionResponse();
    }
    if (method === "REPORT") {
      return answerReport(readBody(init));
    }
    if (method === "PUT") {
      return answerPut(toName(pathname), readBody(init), readHeader(input, init, "if-match"));
    }
    if (method === "DELETE") {
      return answerDelete(toName(pathname));
    }
    return new Response(null, { status: 404 });
  };

  return {
    fetch: ((input: string | Request | URL, init?: RequestInit) =>
      Promise.resolve(answer(input, init))) as unknown as typeof globalThis.fetch,
    names: () => [...objects.keys()],
    read: (name) => objects.get(name)?.data ?? null,
    remove: (name) => {
      objects.delete(name);
    },
    seed: store,
    writes,
  };
};

export {
  createRenamingCalDAVServer,
  RENAMING_CALENDAR_PATH,
  RENAMING_CALENDAR_URL,
  RENAMING_SERVER_URL,
};
export type { RenamingCalDAVServer, RenamingCalDAVServerOptions };

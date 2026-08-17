import type { ProviderSeed } from "@keeper.sh/sync-conformance";
import type { RemoteEvent } from "@keeper.sh/sync-protocol";

interface FakeCalDAVOptions {
  readonly truncatesAfter: number | null;
  readonly capsMultigetAt: number | null;
  readonly rejectsSyncToken: number | null;
  readonly honoursIfMatch: boolean;
  readonly omitsEtagOnPut: boolean;
  readonly offersDigestOnly: boolean;
  readonly offersBasicOnly: boolean;
  readonly returnsUnrequestedRows: boolean;
  readonly returnsPercentEncodedHrefs: boolean;
  readonly emitsBom: boolean;
  readonly announcesSyncCollection: boolean;
  readonly alwaysBusy: boolean;
  readonly retryAfterSeconds: number | null;
  readonly deniesDelete: boolean;
  readonly redirectsTo: string | null;
  readonly stalls: boolean;
  readonly throwsOnMultiget: boolean;
}

const defaultOptions: FakeCalDAVOptions = {
  truncatesAfter: null,
  capsMultigetAt: null,
  rejectsSyncToken: null,
  honoursIfMatch: true,
  omitsEtagOnPut: false,
  offersDigestOnly: false,
  offersBasicOnly: false,
  returnsUnrequestedRows: false,
  returnsPercentEncodedHrefs: false,
  emitsBom: false,
  announcesSyncCollection: true,
  alwaysBusy: false,
  retryAfterSeconds: null,
  deniesDelete: false,
  redirectsTo: null,
  stalls: false,
  throwsOnMultiget: false,
};

interface StoredResource {
  readonly path: string;
  etag: string;
  data: string;
  version: number;
}

interface Tombstone {
  readonly path: string;
  readonly version: number;
}

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly report: string | null;
}

interface BodyAccounting {
  readonly cancelled: number;
  readonly consumed: number;
  readonly issued: number;
}

const serverUrl = "https://dav.example.com";
const principalPath = "/principals/users/alice/";
const calendarHomePath = "/calendars/alice/";
const calendarPath = "/calendars/alice/personal/";
const secondCalendarPath = "/calendars/alice/work/";
const taskCollectionPath = "/calendars/alice/tasks/";
const atticPath = "/attic/";
const conformanceCalendarPath = "/conformance-calendar/";

const storedPathOf = (requestPath: string): string => {
  if (!requestPath.startsWith(conformanceCalendarPath)) {
    return requestPath;
  }
  return `${calendarPath}${requestPath.slice(conformanceCalendarPath.length)}`;
};

const visiblePathOf = (storedPath: string, underCollection: string): string => {
  if (underCollection !== conformanceCalendarPath || !storedPath.startsWith(calendarPath)) {
    return storedPath;
  }
  return `${conformanceCalendarPath}${storedPath.slice(calendarPath.length)}`;
};

const tokenOf = (version: number): string => `http://dav.example.com/ns/sync/${version}`;

const versionOfToken = (token: string | null): number => {
  if (!token) {
    return 0;
  }
  const tail = token.split("/").at(-1);
  const parsed = Number.parseInt(tail ?? "", 10);
  if (Number.isNaN(parsed)) {
    return -1;
  }
  return parsed;
};

const encodedHref = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const hrefsIn = (body: string): readonly string[] =>
  [...body.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/g)].flatMap((match) => {
    const value = match.at(1);
    if (!value) {
      return [];
    }
    return [decodeURIComponent(value.trim())];
  });

const tokenIn = (body: string): string | null => {
  const match = /<[^>]*sync-token[^>]*>([^<]*)<\/[^>]*sync-token>/.exec(body);
  if (!match) {
    return null;
  }
  const value = match.at(1) ?? "";
  if (value.trim().length === 0) {
    return null;
  }
  return value.trim();
};

const reportNameOf = (body: string): string | null => {
  const match = /<[A-Za-z0-9]*:?(sync-collection|calendar-multiget|calendar-query)[\s>]/.exec(body);
  return match?.at(1) ?? null;
};

const nonceCountIn = (authorization: string | null): string | null => {
  if (!authorization) {
    return null;
  }
  const match = /nc=([0-9a-fA-F]+)/.exec(authorization);
  return match?.at(1) ?? null;
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

interface ResponseDraft {
  readonly href: string;
  readonly status: number;
  readonly etag: string | null;
  readonly data: string | null;
  readonly extraProps?: string;
}

const propstatOf = (draft: ResponseDraft): string => {
  if (draft.status !== 200) {
    return `<d:status>HTTP/1.1 ${draft.status} Reported</d:status>`;
  }
  const etag = `<d:getetag>${draft.etag ?? ""}</d:getetag>`;
  const data = (() => {
    if (draft.data === null) {
      return "";
    }
    return `<c:calendar-data>${escapeXml(draft.data)}</c:calendar-data>`;
  })();
  const extra = draft.extraProps ?? "";
  return `<d:propstat><d:prop>${etag}${data}${extra}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
};

interface MultistatusDraft {
  readonly responses: readonly ResponseDraft[];
  readonly syncToken: string | null;
  readonly truncatedHref: string | null;
}

const multistatusXml = (draft: MultistatusDraft): string => {
  const responses = draft.responses
    .map((entry) => `<d:response><d:href>${entry.href}</d:href>${propstatOf(entry)}</d:response>`)
    .join("");
  const truncated = (() => {
    if (!draft.truncatedHref) {
      return "";
    }
    return `<d:response><d:href>${draft.truncatedHref}</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status><d:error><d:number-of-matches-within-limits/></d:error></d:response>`;
  })();
  const token = (() => {
    if (draft.syncToken === null) {
      return "";
    }
    return `<d:sync-token>${draft.syncToken}</d:sync-token>`;
  })();
  return `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${responses}${truncated}${token}</d:multistatus>`;
};

const icsInstant = (value: string): string =>
  value.replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/u, "Z");

const icsDate = (value: string): string => value.replaceAll("-", "");

const escapeIcsText = (value: string): string =>
  value
    .replaceAll("\n", String.raw`\n`)
    .replaceAll(",", String.raw`\,`)
    .replaceAll(";", String.raw`\;`);

const zonedStamp = (name: string, instant: string, zone: string | null): string => {
  if (zone === null || zone === "UTC") {
    return `${name}:${icsInstant(instant)}`;
  }
  return `${name};TZID=${zone}:${icsInstant(instant).replace(/Z$/u, "")}`;
};

const anchorSeconds = (duration: { kind: string; seconds?: number; days?: number }): number => {
  if (typeof duration.seconds === "number") {
    return duration.seconds;
  }
  return (duration.days ?? 1) * 24 * 60 * 60;
};

const timeLinesOf = (content: RemoteEvent["content"]): readonly string[] => {
  if (content.recurrence !== null) {
    const { anchor } = content;
    if (anchor.kind === "allDay") {
      return [
        `DTSTART;VALUE=DATE:${icsDate(anchor.startDate.value)}`,
        `DURATION:P${anchor.duration.days}D`,
      ];
    }
    return [
      zonedStamp("DTSTART", anchor.start.value, anchor.zone.value),
      `DURATION:PT${Math.round(anchorSeconds(anchor.duration))}S`,
    ];
  }
  if (content.time.kind === "allDay") {
    return [
      `DTSTART;VALUE=DATE:${icsDate(content.time.startDate.value)}`,
      `DTEND;VALUE=DATE:${icsDate(content.time.endDateExclusive.value)}`,
    ];
  }
  return [
    zonedStamp("DTSTART", content.time.start.value, content.time.zone?.value ?? null),
    zonedStamp("DTEND", content.time.end.value, content.time.zone?.value ?? null),
  ];
};

const describedLinesOf = (content: RemoteEvent["content"]): readonly string[] => {
  const lines = [`SUMMARY:${escapeIcsText(content.title)}`];
  if (content.description !== null) {
    lines.push(`DESCRIPTION:${escapeIcsText(content.description)}`);
  }
  if (content.location !== null) {
    lines.push(`LOCATION:${escapeIcsText(content.location)}`);
  }
  if (content.availability === "free") {
    lines.push("TRANSP:TRANSPARENT");
  }
  if (content.visibility !== "default") {
    lines.push(`CLASS:${content.visibility.toUpperCase()}`);
  }
  return lines;
};

const recurrenceLinesOf = (content: RemoteEvent["content"]): readonly string[] => {
  if (content.recurrence === null) {
    return [];
  }
  return [
    `RRULE:${content.recurrence.value}`,
    ...content.recurrence.exceptions.map((exception) => `EXDATE:${exception}`),
  ];
};

const veventLinesOf = (event: RemoteEvent): readonly string[] => [
  "BEGIN:VEVENT",
  `UID:${event.uid.value}`,
  "DTSTAMP:19700101T000000Z",
  `SEQUENCE:${event.revision}`,
  ...timeLinesOf(event.content),
  ...describedLinesOf(event.content),
  ...recurrenceLinesOf(event.content),
  "END:VEVENT",
];

const cancelledLines = (lines: readonly string[]): readonly string[] =>
  lines.flatMap((line) => {
    if (line !== "END:VEVENT") {
      return [line];
    }
    return ["STATUS:CANCELLED", line];
  });

const seededResources = (
  events: readonly RemoteEvent[],
  cancelled: ReadonlySet<string>,
): readonly { path: string; data: string }[] => {
  const byUid = new Map<string, RemoteEvent[]>();
  for (const event of events) {
    const carried = byUid.get(event.uid.value) ?? [];
    byUid.set(event.uid.value, [...carried, event]);
  }
  return [...byUid.entries()].map(([uid, revisions]) => {
    const vevents = revisions.flatMap((event) => [...veventLinesOf(event)]);
    const body = (() => {
      if (cancelled.has(uid)) {
        return cancelledLines(vevents);
      }
      return vevents;
    })();
    return {
      path: `${calendarPath}${uid}.ics`,
      data: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//fake//caldav//EN",
        ...body,
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    };
  });
};

const contentTypeOf = (text: string): Readonly<Record<string, string>> => {
  if (!text.startsWith("<?xml")) {
    return {};
  }
  return { "content-type": "application/xml; charset=utf-8" };
};

const requestFrom = (input: string | URL | Request, init?: RequestInit): Request => {
  if (input instanceof Request) {
    return new Request(input, init);
  }
  return new Request(String(input), init);
};

const validSyncTokenXml = (): string =>
  `<?xml version="1.0" encoding="utf-8" ?><d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>`;

interface FakeCalDAV {
  readonly fetch: typeof fetch;
  readonly configure: (options: Partial<FakeCalDAVOptions>) => void;
  readonly put: (path: string, data: string) => void;
  readonly remove: (path: string) => void;
  readonly bumpEtag: (path: string) => void;
  readonly resources: () => readonly StoredResource[];
  readonly resourceAt: (path: string) => StoredResource | null;
  readonly requests: () => readonly RecordedRequest[];
  readonly requestsOf: (method: string) => readonly RecordedRequest[];
  readonly reportsOf: (report: string) => readonly RecordedRequest[];
  readonly nonceCounts: () => readonly string[];
  readonly bodies: () => BodyAccounting;
  readonly seedFromProvider: (seed: ProviderSeed) => void;
  readonly seedResources: (entries: readonly { path: string; data: string }[]) => void;
}

interface FakeOptions {
  readonly options?: Partial<FakeCalDAVOptions>;
  readonly resources?: readonly { path: string; data: string }[];
}

const createFakeCalDAV = (initial: FakeOptions = {}): FakeCalDAV => {
  let options: FakeCalDAVOptions = { ...defaultOptions, ...initial.options };
  const stored = new Map<string, StoredResource>();
  const tombstones: Tombstone[] = [];
  const recorded: RecordedRequest[] = [];
  const nonceCounts: string[] = [];
  const accounting = { cancelled: 0, consumed: 0, issued: 0 };
  let version = 0;
  let rejectionsLeft = 0;

  const bump = (): number => {
    version += 1;
    return version;
  };

  const put = (path: string, data: string): void => {
    const at = bump();
    const existing = stored.get(path);
    if (existing) {
      existing.data = data;
      existing.etag = `"etag-${at}"`;
      existing.version = at;
      return;
    }
    stored.set(path, { path, data, etag: `"etag-${at}"`, version: at });
  };

  const remove = (path: string): void => {
    const at = bump();
    stored.delete(path);
    tombstones.push({ path, version: at });
  };

  const bodyOf = (text: string): ReadableStream<Uint8Array> => {
    accounting.issued += 1;
    let settled = false;
    const settle = (release: "cancelled" | "consumed"): void => {
      if (settled) {
        return;
      }
      settled = true;
      accounting[release] += 1;
    };
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
        settle("consumed");
      },
      cancel: () => {
        settle("cancelled");
      },
    });
  };

  const answer = (
    text: string,
    status: number,
    headers: Readonly<Record<string, string>> = {},
  ): Response => new Response(bodyOf(text), { status, headers: { ...contentTypeOf(text), ...headers } });

  const unauthorised = (): Response => {
    const scheme = (() => {
      if (options.offersBasicOnly) {
        return 'Basic realm="dav"';
      }
      return 'Digest realm="dav", nonce="n-1", qop="auth", algorithm=MD5';
    })();
    return answer("", 401, { "www-authenticate": scheme });
  };

  const authorised = (headers: Headers): boolean => {
    const authorization = headers.get("authorization");
    if (!authorization) {
      return false;
    }
    if (options.offersDigestOnly) {
      return authorization.startsWith("Digest ");
    }
    if (options.offersBasicOnly) {
      return authorization.startsWith("Basic ");
    }
    return true;
  };

  const changedSince = (since: number): readonly StoredResource[] =>
    [...stored.values()].filter((resource) => resource.version > since);

  const removedSince = (since: number): readonly Tombstone[] =>
    tombstones.filter((tombstone) => tombstone.version > since);

  const hrefFor = (path: string): string => {
    if (options.returnsPercentEncodedHrefs) {
      return encodedHref(path);
    }
    return path;
  };

  const dataOf = (resource: StoredResource): string => {
    if (options.emitsBom) {
      return `﻿${resource.data}`;
    }
    return resource.data;
  };

  const changedDraft = (resource: StoredResource, underCollection: string): ResponseDraft => ({
    href: hrefFor(visiblePathOf(resource.path, underCollection)),
    status: 200,
    etag: resource.etag,
    data: dataOf(resource),
  });

  const syncCollection = (body: string, collection: string): Response => {
    const asked = tokenIn(body);
    if (rejectionsLeft > 0) {
      rejectionsLeft -= 1;
      return answer(validSyncTokenXml(), options.rejectsSyncToken ?? 403);
    }
    const since = versionOfToken(asked);
    if (since < 0) {
      return answer(validSyncTokenXml(), options.rejectsSyncToken ?? 403);
    }
    const changed = changedSince(since);
    const removed = removedSince(since);
    const ordered = [
      ...changed.map((resource) => ({
        version: resource.version,
        draft: changedDraft(resource, collection),
      })),
      ...removed.map((tombstone) => ({
        version: tombstone.version,
        draft: {
          href: hrefFor(visiblePathOf(tombstone.path, collection)),
          status: 404,
          etag: null,
          data: null,
        },
      })),
    ].toSorted((left, right) => left.version - right.version);
    const ceiling = options.truncatesAfter;
    if (ceiling === null || ordered.length <= ceiling) {
      return answer(
        multistatusXml({
          responses: ordered.map((entry) => entry.draft),
          syncToken: tokenOf(version),
          truncatedHref: null,
        }),
        207,
      );
    }
    const page = ordered.slice(0, ceiling);
    const last = page.at(-1);
    return answer(
      multistatusXml({
        responses: page.map((entry) => entry.draft),
        syncToken: tokenOf(last?.version ?? since),
        truncatedHref: hrefFor(collection),
      }),
      207,
    );
  };

  const multiget = (body: string, collection: string): Response => {
    const asked = hrefsIn(body);
    const found = asked.flatMap((href) => {
      const resource = stored.get(storedPathOf(href));
      if (!resource) {
        return [];
      }
      return [resource];
    });
    const capped = (() => {
      if (options.capsMultigetAt === null) {
        return found;
      }
      return found.slice(0, options.capsMultigetAt);
    })();
    const extra = (() => {
      if (!options.returnsUnrequestedRows) {
        return [];
      }
      return [
        {
          href: hrefFor(`${collection}nobody-asked.ics`),
          status: 200,
          etag: '"etag-unasked"',
          data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
        },
      ];
    })();
    return answer(
      multistatusXml({
        responses: [...capped.map((resource) => changedDraft(resource, collection)), ...extra],
        syncToken: null,
        truncatedHref: null,
      }),
      207,
    );
  };

  const supportedReportSetXml = (): string => {
    const announced: string[] = ["c:calendar-multiget"];
    if (options.announcesSyncCollection) {
      announced.unshift("d:sync-collection");
    }
    const reports = announced;
    const entries = reports
      .map((report) => `<d:supported-report><d:report><${report}/></d:report></d:supported-report>`)
      .join("");
    return `<d:supported-report-set>${entries}</d:supported-report-set>`;
  };

  const collectionComponents: Readonly<Record<string, string>> = {
    [calendarPath]: "VEVENT",
    [secondCalendarPath]: "VEVENT",
    [taskCollectionPath]: "VTODO",
  };

  const propsAskedFor = (body: string, path: string): string => {
    const asked: string[] = [];
    if (body.includes("supported-report-set")) {
      asked.push(supportedReportSetXml());
    }
    if (body.includes("getctag")) {
      asked.push(`<cs:getctag>ctag-${version}</cs:getctag>`);
    }
    if (body.includes("sync-token")) {
      asked.push(`<d:sync-token>${tokenOf(version)}</d:sync-token>`);
    }
    if (body.includes("current-user-privilege-set")) {
      asked.push(
        `<d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>`,
      );
    }
    if (body.includes("displayname")) {
      asked.push(`<d:displayname>${path}</d:displayname>`);
    }
    if (body.includes("resourcetype")) {
      asked.push(`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>`);
    }
    if (body.includes("supported-calendar-component-set")) {
      const component = collectionComponents[path] ?? "VEVENT";
      asked.push(
        `<c:supported-calendar-component-set><c:comp name="${component}"/></c:supported-calendar-component-set>`,
      );
    }
    return asked.join("");
  };

  const discoveryProps = (body: string, path: string): string | null => {
    if (body.includes("current-user-principal")) {
      return `<d:current-user-principal><d:href>${principalPath}</d:href></d:current-user-principal>`;
    }
    if (body.includes("calendar-home-set")) {
      return `<c:calendar-home-set><d:href>${calendarHomePath}</d:href></c:calendar-home-set>`;
    }
    if (path === principalPath || path === "/") {
      return propsAskedFor(body, path);
    }
    return null;
  };

  const homeRows = (body: string): readonly ResponseDraft[] =>
    [calendarPath, secondCalendarPath, taskCollectionPath].map((href) => ({
      href: hrefFor(href),
      status: 200,
      etag: "",
      data: null,
      extraProps: propsAskedFor(body, href),
    }));

  const propfind = (path: string, depth: string | null, body: string): Response => {
    const discovered = discoveryProps(body, path);
    if (discovered !== null) {
      return answer(
        multistatusXml({
          responses: [
            { href: hrefFor(path), status: 200, etag: "", data: null, extraProps: discovered },
          ],
          syncToken: null,
          truncatedHref: null,
        }),
        207,
      );
    }
    const extraProps = propsAskedFor(body, path);
    if (path === calendarHomePath) {
      return answer(
        multistatusXml({ responses: homeRows(body), syncToken: null, truncatedHref: null }),
        207,
      );
    }
    if (depth === "0") {
      const resource = stored.get(storedPathOf(path));
      return answer(
        multistatusXml({
          responses: [
            { href: hrefFor(path), status: 200, etag: resource?.etag ?? "", data: null, extraProps },
          ],
          syncToken: null,
          truncatedHref: null,
        }),
        207,
      );
    }
    const under = storedPathOf(path);
    const members = [...stored.values()].filter((resource) => resource.path.startsWith(under));
    const ceiling = options.truncatesAfter;
    const capped = (() => {
      if (ceiling === null || members.length <= ceiling) {
        return { rows: members, truncated: false };
      }
      return { rows: members.slice(0, ceiling), truncated: true };
    })();
    return answer(
      multistatusXml({
        responses: [
          { href: hrefFor(path), status: 200, etag: "", data: null, extraProps },
          ...capped.rows.map((resource) => ({
            href: hrefFor(visiblePathOf(resource.path, path)),
            status: 200,
            etag: resource.etag,
            data: null,
          })),
        ],
        syncToken: null,
        truncatedHref: (() => {
          if (!capped.truncated) {
            return null;
          }
          return hrefFor(path);
        })(),
      }),
      207,
    );
  };

  const writeResource = (path: string, headers: Headers, body: string): Response => {
    const existing = stored.get(path);
    const ifNoneMatch = headers.get("if-none-match");
    const ifMatch = headers.get("if-match");
    if (ifNoneMatch === "*" && existing) {
      return answer("", 412);
    }
    if (ifMatch && options.honoursIfMatch && existing?.etag !== ifMatch) {
      return answer("", 412);
    }
    put(path, body);
    const written = stored.get(path);
    if (options.omitsEtagOnPut || !written) {
      return answer("", 204);
    }
    return answer("", 204, { etag: written.etag });
  };

  const deleteResource = (path: string, headers: Headers): Response => {
    if (options.deniesDelete) {
      return answer("", 403);
    }
    const existing = stored.get(path);
    if (!existing) {
      return answer("", 404);
    }
    const ifMatch = headers.get("if-match");
    if (options.honoursIfMatch && existing.etag !== ifMatch) {
      return answer("", 412);
    }
    remove(path);
    return answer("", 204);
  };

  const route = (method: string, path: string, headers: Headers, body: string): Response => {
    if (method === "PROPFIND") {
      return propfind(path, headers.get("depth"), body);
    }
    if (method === "PUT") {
      return writeResource(storedPathOf(path), headers, body);
    }
    if (method === "DELETE") {
      return deleteResource(storedPathOf(path), headers);
    }
    if (method === "REPORT") {
      if (options.throwsOnMultiget) {
        throw new TypeError("the socket closed before the report answered");
      }
      const report = reportNameOf(body);
      if (report === "sync-collection") {
        return syncCollection(body, path);
      }
      return multiget(body, path);
    }
    return answer("", 405);
  };

  const handle = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = requestFrom(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    const headers = new Headers(request.headers);
    const method = request.method.toUpperCase();
    recorded.push({
      method,
      path: decodeURIComponent(url.pathname),
      headers: Object.fromEntries(headers.entries()),
      body,
      report: reportNameOf(body),
    });
    const nonceCount = nonceCountIn(headers.get("authorization"));
    if (nonceCount) {
      nonceCounts.push(nonceCount);
    }
    if (options.stalls) {
      return Promise.withResolvers<Response>().promise;
    }
    if (options.redirectsTo) {
      return answer("", 302, { location: options.redirectsTo });
    }
    if (options.alwaysBusy) {
      const retryAfter = options.retryAfterSeconds;
      if (retryAfter === null) {
        return answer("", 503);
      }
      return answer("", 503, { "retry-after": String(retryAfter) });
    }
    if (!authorised(headers)) {
      return unauthorised();
    }
    return route(method, decodeURIComponent(url.pathname), headers, body);
  };

  const fakeFetch: typeof fetch = Object.assign(handle, {
    preconnect: (): Promise<void> => Promise.resolve(),
  });

  for (const entry of initial.resources ?? []) {
    put(entry.path, entry.data);
  }

  return {
    fetch: fakeFetch,
    configure: (next: Partial<FakeCalDAVOptions>) => {
      options = { ...options, ...next };
      if (typeof next.rejectsSyncToken === "number") {
        rejectionsLeft = 1;
      }
    },
    put,
    remove,
    bumpEtag: (path: string) => {
      const resource = stored.get(path);
      if (!resource) {
        return;
      }
      put(path, resource.data);
    },
    resources: () => [...stored.values()],
    resourceAt: (path: string) => stored.get(path) ?? null,
    requests: () => [...recorded],
    requestsOf: (method: string) => recorded.filter((entry) => entry.method === method),
    reportsOf: (report: string) => recorded.filter((entry) => entry.report === report),
    nonceCounts: () => [...nonceCounts],
    bodies: () => ({ ...accounting }),
    seedFromProvider: (seed: ProviderSeed) => {
      const cancelled = new Set(seed.cancelled.map((uid) => uid.value));
      const wanted = seededResources(seed.events, cancelled);
      const seededPaths = new Set(wanted.map((entry) => entry.path));
      for (const resource of stored.values()) {
        if (resource.path.startsWith(calendarPath) && !seededPaths.has(resource.path)) {
          remove(resource.path);
        }
      }
      for (const entry of wanted) {
        const existing = stored.get(entry.path);
        if (existing?.data === entry.data) {
          continue;
        }
        put(entry.path, entry.data);
      }
      for (const id of seed.unattributableRemovals) {
        const orphan = `${atticPath}${id.value}.ics`;
        put(orphan, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
        remove(orphan);
      }
    },
    seedResources: (entries: readonly { path: string; data: string }[]) => {
      for (const entry of entries) {
        put(entry.path, entry.data);
      }
    },
  };
};

export {
  atticPath,
  calendarHomePath,
  calendarPath,
  createFakeCalDAV,
  principalPath,
  secondCalendarPath,
  serverUrl,
  taskCollectionPath,
  tokenOf,
};
export type { BodyAccounting, FakeCalDAV, FakeCalDAVOptions, RecordedRequest, StoredResource };

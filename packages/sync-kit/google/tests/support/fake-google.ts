import type { calendar_v3 } from "@googleapis/calendar";
import type { ProviderSeed } from "@keeper.sh/sync-conformance";
import type { Availability, EventTime, InstallationId, RemoteEvent } from "@keeper.sh/sync-protocol";
import type { FetchImplementation } from "../../src/client/calendar-client";
import { provenancePropertyKey } from "../../src/decode/provenance";

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly search: Readonly<Record<string, string>>;
  readonly ifMatch: string | null;
  readonly body: unknown;
}

interface ScriptedFailure {
  readonly onCall: number;
  readonly status: number;
  readonly reason: string;
  readonly bodyShape: ErrorBodyShape;
}

const errorBodyShapes = ["json", "empty", "text", "redacted"] as const;
type ErrorBodyShape = (typeof errorBodyShapes)[number];

interface FakeGoogleOptions {
  readonly installation: InstallationId;
  readonly calendarId: string;
  readonly startedAt: string;
}

interface FakeGoogle {
  readonly fetch: FetchImplementation;
  readonly seedFromProvider: (seed: ProviderSeed) => void;
  readonly putItems: (items: readonly calendar_v3.Schema$Event[]) => void;
  readonly cancelItem: (id: string) => void;
  readonly stripInstallationStamp: (id: string) => void;
  readonly items: () => readonly calendar_v3.Schema$Event[];
  readonly requests: () => readonly RecordedRequest[];
  readonly listCallCount: () => number;
  readonly channels: () => readonly calendar_v3.Schema$Channel[];
  readonly failListOn: (failure: ScriptedFailure) => void;
  readonly failWriteOn: (failure: ScriptedFailure) => void;
  readonly withholdSyncToken: () => void;
  readonly pageEvery: (size: number) => void;
  readonly neverStopPaging: () => void;
  readonly answerCalendarListWith: (body: unknown) => void;
  readonly declareStoredRowsCorrupt: () => void;
}

const rootPath = "/calendar/v3";

const jsonResponse = (status: number, body: unknown, headers: Headers): Response =>
  Response.json(body, { status, headers });

const headersOf = (entries: Readonly<Record<string, string>>): Headers => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, value] of Object.entries(entries)) {
    headers.set(name, value);
  }
  return headers;
};

const googleErrorBody = (status: number, reason: string): unknown => ({
  error: {
    code: status,
    message: `the fake Google answered ${status}`,
    errors: [{ domain: "global", reason, message: `the fake Google answered ${status}` }],
  },
});

const errorResponse = (failure: ScriptedFailure): Response => {
  const headers = headersOf({});
  if (failure.bodyShape === "empty") {
    return new Response(null, { status: failure.status, headers });
  }
  if (failure.bodyShape === "text") {
    return new Response("<html>backend error</html>", {
      status: failure.status,
      headers: headersOf({ "content-type": "text/html" }),
    });
  }
  if (failure.bodyShape === "redacted") {
    return jsonResponse(failure.status, { error: "REDACTED" }, headers);
  }
  return jsonResponse(failure.status, googleErrorBody(failure.status, failure.reason), headers);
};

const transparencyOf = (availability: Availability): string => {
  if (availability === "free") {
    return "transparent";
  }
  return "opaque";
};

const timeFieldsOf = (
  time: EventTime,
): { start: calendar_v3.Schema$EventDateTime; end: calendar_v3.Schema$EventDateTime } => {
  if (time.kind === "allDay") {
    return {
      start: { date: time.startDate.value },
      end: { date: time.endDateExclusive.value },
    };
  }
  return {
    start: { dateTime: time.start.value, timeZone: time.zone?.value ?? "UTC" },
    end: { dateTime: time.end.value, timeZone: time.zone?.value ?? "UTC" },
  };
};

const extendedPropertiesOf = (
  event: RemoteEvent,
): Pick<calendar_v3.Schema$Event, "extendedProperties"> => {
  if (event.provenance.kind !== "ours") {
    return {};
  }
  return {
    extendedProperties: {
      private: { [provenancePropertyKey]: event.provenance.installation.value },
    },
  };
};

const updatedOf = (event: RemoteEvent, startedAt: string): string =>
  new Date(Date.parse(startedAt) + event.revision * 1000).toISOString();

const anchorTimeOf = (anchor: RemoteEvent["content"]["anchor"]): EventTime => {
  if (!anchor) {
    throw new Error("a recurring seed event carried no anchor");
  }
  if (anchor.kind === "allDay") {
    return {
      kind: "allDay",
      startDate: anchor.startDate,
      endDateExclusive: anchor.startDate,
    };
  }
  return { kind: "timed", start: anchor.start, end: anchor.start, zone: anchor.zone };
};

const scriptedFailureFor = (
  failures: readonly ScriptedFailure[],
  call: number,
): ScriptedFailure | null => failures.find((failure) => failure.onCall === call) ?? null;

const itemOfRemoteEvent = (
  event: RemoteEvent,
  startedAt: string,
): calendar_v3.Schema$Event => {
  const { content } = event;
  const shared = {
    id: event.id.value,
    iCalUID: event.uid.value,
    etag: `"${event.version.value}"`,
    status: "confirmed",
    summary: content.title,
    description: content.description,
    location: content.location,
    transparency: transparencyOf(content.availability),
    visibility: content.visibility,
    updated: updatedOf(event, startedAt),
    ...extendedPropertiesOf(event),
  };
  if (content.recurrence === null) {
    return { ...shared, ...timeFieldsOf(content.time) };
  }
  return {
    ...shared,
    recurrence: [content.recurrence.value, ...content.recurrence.exceptions],
    ...timeFieldsOf(anchorTimeOf(content.anchor)),
  };
};

const searchOf = (url: URL): Readonly<Record<string, string>> => {
  const search: Record<string, string> = {};
  for (const [name, value] of url.searchParams.entries()) {
    search[name] = value;
  }
  return search;
};

const requestOf = (input: string | URL | Request, init?: RequestInit): Request => {
  if (input instanceof Request) {
    return new Request(input, init);
  }
  return new Request(input.toString(), init);
};

const bodyOf = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (text.length === 0) {
    return null;
  }
  return JSON.parse(text);
};

const createFakeGoogle = (options: FakeGoogleOptions): FakeGoogle => {
  const stored: calendar_v3.Schema$Event[] = [];
  const recorded: RecordedRequest[] = [];
  const openChannels: calendar_v3.Schema$Channel[] = [];
  const listFailures: ScriptedFailure[] = [];
  const writeFailures: ScriptedFailure[] = [];
  let listCalls = 0;
  let writeCalls = 0;
  let pageSize = Number.POSITIVE_INFINITY;
  let endlessPages = false;
  let withheldSyncToken = false;
  let corruptStoredRows = false;
  let calendarListBody: unknown = null;
  let issuedTokens = 0;

  const pageOf = (items: readonly calendar_v3.Schema$Event[], pageToken: string | null) => {
    const from = Number.parseInt(pageToken ?? "0", 10);
    const slice = items.slice(from, from + pageSize);
    const consumed = from + slice.length;
    if (endlessPages) {
      return { slice: items.slice(0, 1), nextPageToken: `${consumed + 1}`, last: false };
    }
    if (consumed < items.length) {
      return { slice, nextPageToken: `${consumed}`, last: false };
    }
    return { slice, nextPageToken: null, last: true };
  };

  const lastIndexOfId = (id: string): number =>
    stored.findLastIndex((item) => item.id === id);

  const itemWithId = (id: string): calendar_v3.Schema$Event | null => {
    const position = lastIndexOfId(id);
    if (position === -1) {
      return null;
    }
    return stored.at(position) ?? null;
  };

  const replaceAt = (position: number, item: calendar_v3.Schema$Event): void => {
    stored.splice(position, 1, item);
  };

  const tombstonesFor = (
    events: readonly RemoteEvent[],
  ): readonly calendar_v3.Schema$Event[] => {
    const surviving = new Set(events.map((event) => event.id.value));
    const vanished = new Map<string, calendar_v3.Schema$Event>();
    for (const item of stored) {
      if (typeof item.id !== "string" || surviving.has(item.id)) {
        continue;
      }
      vanished.set(item.id, { ...item, status: "cancelled" });
    }
    return [...vanished.values()];
  };

  const listBody = (pageToken: string | null): unknown => {
    const page = pageOf([...stored], pageToken);
    issuedTokens += 1;
    const base = { kind: "calendar#events", items: page.slice };
    if (!page.last) {
      return { ...base, nextPageToken: page.nextPageToken };
    }
    if (withheldSyncToken) {
      return base;
    }
    return { ...base, nextSyncToken: `google-sync-token-${issuedTokens}` };
  };

  const answerList = (url: URL): Response => {
    listCalls += 1;
    if (corruptStoredRows) {
      return errorResponse({
        onCall: listCalls,
        status: 410,
        reason: "fullSyncRequired",
        bodyShape: "json",
      });
    }
    const failure = scriptedFailureFor(listFailures, listCalls);
    if (failure !== null) {
      return errorResponse(failure);
    }
    return jsonResponse(200, listBody(url.searchParams.get("pageToken")), headersOf({}));
  };

  const answerEvent = (eventId: string): Response => {
    const found = itemWithId(eventId);
    if (!found) {
      return errorResponse({ onCall: 0, status: 404, reason: "notFound", bodyShape: "json" });
    }
    return jsonResponse(200, found, headersOf({ etag: found.etag ?? "" }));
  };

  const answerCalendarList = (): Response => {
    if (calendarListBody !== null) {
      return jsonResponse(200, calendarListBody, headersOf({}));
    }
    return jsonResponse(
      200,
      {
        kind: "calendar#calendarList",
        items: [
          {
            id: options.calendarId,
            summary: "Fake calendar",
            timeZone: "UTC",
            accessRole: "owner",
          },
        ],
      },
      headersOf({}),
    );
  };

  const insert = (body: unknown): Response => {
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, reason: "invalid", bodyShape: "json" });
    }
    const submitted: calendar_v3.Schema$Event = body;
    const id = submitted.id ?? `generated-${writeCalls}`;
    const existing = itemWithId(id);
    if (existing) {
      return errorResponse({
        onCall: writeCalls,
        status: 409,
        reason: "duplicate",
        bodyShape: "json",
      });
    }
    const created = { ...submitted, id, etag: `"v1-${id}"`, status: "confirmed" };
    stored.push(created);
    return jsonResponse(200, created, headersOf({ etag: `"v1-${id}"` }));
  };

  const patch = (id: string, body: unknown, ifMatch: string | null): Response => {
    const position = lastIndexOfId(id);
    const existing = stored.at(position);
    if (position === -1 || !existing) {
      return errorResponse({
        onCall: writeCalls,
        status: 404,
        reason: "notFound",
        bodyShape: "json",
      });
    }
    if (ifMatch !== null && ifMatch !== existing.etag) {
      return errorResponse({
        onCall: writeCalls,
        status: 412,
        reason: "conditionNotMet",
        bodyShape: "json",
      });
    }
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, reason: "invalid", bodyShape: "json" });
    }
    const revision = Number.parseInt((existing.etag ?? `"v1-${id}"`).slice(2), 10) + 1;
    const next = { ...existing, ...body, id, etag: `"v${revision}-${id}"` };
    replaceAt(position, next);
    return jsonResponse(200, next, headersOf({ etag: `"v${revision}-${id}"` }));
  };

  const remove = (id: string, ifMatch: string | null): Response => {
    const existing = itemWithId(id);
    if (!existing) {
      return errorResponse({ onCall: writeCalls, status: 410, reason: "deleted", bodyShape: "json" });
    }
    if (ifMatch !== null && ifMatch !== existing.etag) {
      return errorResponse({
        onCall: writeCalls,
        status: 412,
        reason: "conditionNotMet",
        bodyShape: "json",
      });
    }
    for (let position = stored.length - 1; position >= 0; position -= 1) {
      if (stored.at(position)?.id === id) {
        stored.splice(position, 1);
      }
    }
    return new Response(null, { status: 204 });
  };

  const watch = (body: unknown): Response => {
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, reason: "invalid", bodyShape: "json" });
    }
    const requested: calendar_v3.Schema$Channel = body;
    const channel = {
      ...requested,
      resourceId: `resource-${openChannels.length + 1}`,
      expiration: `${Date.parse(options.startedAt) + 7 * 24 * 60 * 60 * 1000}`,
    };
    openChannels.push(channel);
    return jsonResponse(200, channel, headersOf({}));
  };

  const stopChannel = (body: unknown): Response => {
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, reason: "invalid", bodyShape: "json" });
    }
    const requested: calendar_v3.Schema$Channel = body;
    const index = openChannels.findIndex((channel) => channel.id === requested.id);
    if (index === -1) {
      return errorResponse({ onCall: writeCalls, status: 404, reason: "notFound", bodyShape: "json" });
    }
    openChannels.splice(index, 1);
    return new Response(null, { status: 204 });
  };

  const answerWrite = (method: string, url: URL, body: unknown, ifMatch: string | null): Response => {
    writeCalls += 1;
    const failure = scriptedFailureFor(writeFailures, writeCalls);
    if (failure !== null) {
      return errorResponse(failure);
    }
    if (url.pathname.endsWith("/events/watch")) {
      return watch(body);
    }
    if (url.pathname.endsWith("/channels/stop")) {
      return stopChannel(body);
    }
    const eventId = url.pathname.split("/events/").at(1) ?? "";
    if (method === "POST") {
      return insert(body);
    }
    if (method === "PATCH" || method === "PUT") {
      return patch(decodeURIComponent(eventId), body, ifMatch);
    }
    if (method === "DELETE") {
      return remove(decodeURIComponent(eventId), ifMatch);
    }
    return errorResponse({ onCall: writeCalls, status: 405, reason: "invalid", bodyShape: "json" });
  };

  const answer = (method: string, url: URL, body: unknown, ifMatch: string | null): Response => {
    if (!url.pathname.startsWith(rootPath)) {
      return errorResponse({ onCall: 0, status: 404, reason: "notFound", bodyShape: "json" });
    }
    if (method === "GET" && url.pathname.includes("/users/me/calendarList")) {
      return answerCalendarList();
    }
    if (method === "GET" && url.pathname.endsWith("/events")) {
      return answerList(url);
    }
    if (method === "GET" && url.pathname.includes("/events/")) {
      return answerEvent(decodeURIComponent(url.pathname.split("/events/").at(1) ?? ""));
    }
    return answerWrite(method, url, body, ifMatch);
  };

  const fakeFetch: FetchImplementation = async (input, init) => {
    const request = requestOf(input, init);
    const url = new URL(request.url);
    const ifMatch = request.headers.get("if-match");
    const body = await bodyOf(request);
    recorded.push({
      method: request.method,
      path: url.pathname,
      search: searchOf(url),
      ifMatch,
      body,
    });
    return answer(request.method, url, body, ifMatch);
  };

  return {
    fetch: fakeFetch,
    seedFromProvider: (seed: ProviderSeed) => {
      const vanished = tombstonesFor(seed.events);
      stored.length = 0;
      for (const event of seed.events) {
        stored.push(itemOfRemoteEvent(event, options.startedAt));
      }
      stored.push(...vanished);
      for (const uid of seed.cancelled) {
        for (const [position, item] of stored.entries()) {
          if (item.iCalUID === uid.value) {
            replaceAt(position, { ...item, status: "cancelled" });
          }
        }
      }
      for (const id of seed.unattributableRemovals) {
        stored.push({ id: id.value, status: "cancelled" });
      }
      corruptStoredRows = seed.corruptKnownRows.length > 0;
    },
    putItems: (items: readonly calendar_v3.Schema$Event[]) => {
      stored.push(...items);
    },
    cancelItem: (id: string) => {
      const position = lastIndexOfId(id);
      const existing = stored.at(position);
      if (position === -1 || !existing) {
        stored.push({ id, status: "cancelled" });
        return;
      }
      replaceAt(position, { ...existing, status: "cancelled" });
    },
    stripInstallationStamp: (id: string) => {
      const position = lastIndexOfId(id);
      const existing = stored.at(position);
      if (position === -1 || !existing) {
        return;
      }
      const held = existing.extendedProperties?.private ?? {};
      const { "keeper.sh/installation": _dropped, ...kept } = held;
      replaceAt(position, { ...existing, extendedProperties: { private: kept } });
    },
    items: () => [...stored],
    requests: () => [...recorded],
    listCallCount: () => listCalls,
    channels: () => [...openChannels],
    failListOn: (failure: ScriptedFailure) => {
      listFailures.push(failure);
    },
    failWriteOn: (failure: ScriptedFailure) => {
      writeFailures.push(failure);
    },
    withholdSyncToken: () => {
      withheldSyncToken = true;
    },
    pageEvery: (size: number) => {
      pageSize = size;
    },
    neverStopPaging: () => {
      endlessPages = true;
    },
    answerCalendarListWith: (body: unknown) => {
      calendarListBody = body;
    },
    declareStoredRowsCorrupt: () => {
      corruptStoredRows = true;
    },
  };
};

export { createFakeGoogle, errorBodyShapes, googleErrorBody };
export type { ErrorBodyShape, FakeGoogle, FakeGoogleOptions, RecordedRequest, ScriptedFailure };

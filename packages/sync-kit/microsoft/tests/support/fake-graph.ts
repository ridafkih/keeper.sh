import type { ProviderSeed } from "@keeper.sh/sync-conformance";
import type {
  Availability,
  EventTime,
  InstallationId,
  RemoteEvent,
  Visibility,
} from "@keeper.sh/sync-protocol";
import type {
  Event as GraphEvent,
  FreeBusyStatus,
  Sensitivity,
  Subscription,
} from "@microsoft/microsoft-graph-types";
import type { FetchImplementation } from "../../src/client/graph-client";
import { provenanceCategory, provenancePropertyName } from "../../src/decode/provenance";

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly search: Readonly<Record<string, string>>;
  readonly prefer: string | null;
  readonly ifMatch: string | null;
  readonly body: unknown;
}

const errorBodyShapes = ["json", "empty", "text", "redacted", "hostile"] as const;
type ErrorBodyShape = (typeof errorBodyShapes)[number];

interface ScriptedFailure {
  readonly onCall: number;
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: string;
  readonly bodyShape?: ErrorBodyShape;
}

interface FakeGraphOptions {
  readonly installation: InstallationId;
  readonly account: string;
  readonly calendarId: string;
  readonly startedAt: string;
}

interface FakeGraph {
  readonly fetch: FetchImplementation;
  readonly seedFromProvider: (seed: ProviderSeed) => void;
  readonly putItems: (items: readonly GraphEvent[]) => void;
  readonly putRaw: (items: readonly unknown[]) => void;
  readonly putInstances: (masterId: string, instances: readonly GraphEvent[]) => void;
  readonly failInstancesFor: (masterId: string) => void;
  readonly items: () => readonly GraphEvent[];
  readonly requests: () => readonly RecordedRequest[];
  readonly listCallCount: () => number;
  readonly writeCallCount: () => number;
  readonly subscriptions: () => readonly Subscription[];
  readonly putSubscription: (subscription: Subscription) => void;
  readonly failListOn: (failure: ScriptedFailure) => void;
  readonly failWriteOn: (failure: ScriptedFailure) => void;
  readonly answerCalendarsWith: (body: unknown) => void;
  readonly pageEvery: (size: number) => void;
  readonly cyclesNextLink: () => void;
  readonly repeatsLinkAfter: (pages: number) => void;
  readonly withholdDeltaLink: () => void;
  readonly honoursIfMatch: (honours: boolean) => void;
  readonly rewritesBody: (rewrites: boolean) => void;
  readonly mutateItem: (id: string, patch: GraphEvent) => void;
  readonly removeItem: (id: string, reason: string | null) => void;
  readonly deleteBodyWasCancelled: () => boolean;
  readonly withholdSubscriptionId: () => void;
}

const graphRoot = "https://graph.microsoft.com";

const headersOf = (entries: Readonly<Record<string, string>>): Headers => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, value] of Object.entries(entries)) {
    headers.set(name, value);
  }
  return headers;
};

const graphErrorBody = (status: number, code: string): unknown => ({
  error: {
    code,
    message: `the fake Graph answered ${status}`,
    innerError: { "request-id": "fake-request", date: "2026-03-11T00:00:00" },
  },
});

const hostileBodies: readonly unknown[] = [null, [], "x".repeat(4096)];

const errorResponse = (failure: ScriptedFailure): Response => {
  const shape = failure.bodyShape ?? "json";
  const headers = headersOf({});
  if (typeof failure.retryAfter === "string") {
    headers.set("retry-after", failure.retryAfter);
  }
  if (shape === "empty") {
    return new Response(null, { status: failure.status, headers });
  }
  if (shape === "text") {
    return new Response("<html>backend error</html>", {
      status: failure.status,
      headers: headersOf({ "content-type": "text/html" }),
    });
  }
  if (shape === "redacted") {
    return Response.json({ error: "REDACTED" }, { status: failure.status, headers });
  }
  if (shape === "hostile") {
    return Response.json(hostileBodies.at(0) ?? null, { status: failure.status, headers });
  }
  return Response.json(graphErrorBody(failure.status, failure.code), {
    status: failure.status,
    headers,
  });
};

const showAsOf = (availability: Availability): FreeBusyStatus => {
  if (availability === "free") {
    return "free";
  }
  return "busy";
};

const sensitivityOf = (visibility: Visibility): Sensitivity => {
  if (visibility === "private") {
    return "private";
  }
  return "normal";
};

const timeFieldsOf = (time: EventTime): Pick<GraphEvent, "start" | "end" | "isAllDay"> => {
  if (time.kind === "allDay") {
    return {
      start: { dateTime: `${time.startDate.value}T00:00:00.0000000`, timeZone: "UTC" },
      end: { dateTime: `${time.endDateExclusive.value}T00:00:00.0000000`, timeZone: "UTC" },
      isAllDay: true,
    };
  }
  return {
    start: { dateTime: time.start.value.replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: time.end.value.replace("Z", ""), timeZone: "UTC" },
    isAllDay: false,
  };
};

const provenanceFieldsOf = (
  event: RemoteEvent,
): Pick<GraphEvent, "singleValueExtendedProperties" | "categories"> => {
  if (event.provenance.kind !== "ours") {
    return { categories: [] };
  }
  return {
    categories: [provenanceCategory],
    singleValueExtendedProperties: [
      { id: provenancePropertyName, value: event.provenance.installation.value },
    ],
  };
};

const anchorTimeOf = (anchor: RemoteEvent["content"]["anchor"]): EventTime => {
  if (!anchor) {
    throw new Error("a recurring seed event carried no anchor");
  }
  if (anchor.kind === "allDay") {
    return { kind: "allDay", startDate: anchor.startDate, endDateExclusive: anchor.startDate };
  }
  return { kind: "timed", start: anchor.start, end: anchor.start, zone: anchor.zone };
};

const itemOfRemoteEvent = (event: RemoteEvent, startedAt: string): GraphEvent => {
  const { content } = event;
  const shared: GraphEvent = {
    id: event.id.value,
    iCalUId: event.uid.value,
    changeKey: event.version.value,
    subject: content.title,
    body: { contentType: "text", content: content.description ?? "" },
    location: { displayName: content.location ?? "" },
    showAs: showAsOf(content.availability),
    sensitivity: sensitivityOf(content.visibility),
    isCancelled: false,
    type: "singleInstance",
    seriesMasterId: null,
    originalStartTimeZone: "UTC",
    originalEndTimeZone: "UTC",
    createdDateTime: startedAt,
    lastModifiedDateTime: new Date(Date.parse(startedAt) + event.revision * 1000).toISOString(),
    ...provenanceFieldsOf(event),
  };
  if (content.recurrence === null) {
    return { ...shared, ...timeFieldsOf(content.time) };
  }
  return {
    ...shared,
    type: "seriesMaster",
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
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const idOfItem = (item: GraphEvent): string => item.id ?? "";

const expandsExtendedProperties = (url: URL): boolean =>
  (url.searchParams.get("$expand") ?? "").includes("singleValueExtendedProperties");

const withoutExtendedProperties = (item: unknown): unknown => {
  if (typeof item !== "object" || item === null) {
    return item;
  }
  const held: Record<string, unknown> = { ...item };
  Reflect.deleteProperty(held, "singleValueExtendedProperties");
  return held;
};

const asGraphRetrieves = (url: URL, items: readonly unknown[]): readonly unknown[] => {
  if (expandsExtendedProperties(url)) {
    return items;
  }
  return items.map((item) => withoutExtendedProperties(item));
};

const propertyFilterOf = (url: URL): { readonly id: string; readonly value: string } | null => {
  const filter = url.searchParams.get("$filter");
  if (filter === null) {
    return null;
  }
  const matched = /ep\/id eq '([^']*)' and ep\/value eq '([^']*)'/.exec(filter);
  if (!matched) {
    return null;
  }
  return { id: matched[1] ?? "", value: matched[2] ?? "" };
};

const carriesProperty = (item: unknown, id: string, value: string): boolean => {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const held = Reflect.get(item, "singleValueExtendedProperties");
  if (!Array.isArray(held)) {
    return false;
  }
  return held.some((property) => property?.id === id && property?.value === value);
};

const scriptedFailureFor = (
  failures: readonly ScriptedFailure[],
  call: number,
): ScriptedFailure | null => failures.find((failure) => failure.onCall === call) ?? null;

const offsetOfToken = (token: string | null): number => {
  if (token === null || !token.startsWith("page-")) {
    return 0;
  }
  return Number.parseInt(token.slice("page-".length), 10);
};

const subscriptionIdOf = (pathname: string): string =>
  decodeURIComponent(pathname.split("/subscriptions/").at(1) ?? "");

const eventIdOf = (pathname: string): string =>
  decodeURIComponent((pathname.split("/events/").at(1) ?? "").split("/").at(0) ?? "");


const createFakeGraph = (options: FakeGraphOptions): FakeGraph => {
  const stored: GraphEvent[] = [];
  const extras: unknown[] = [];
  const instancesOf = new Map<string, readonly GraphEvent[]>();
  const failingInstances = new Set<string>();
  const recorded: RecordedRequest[] = [];
  const openSubscriptions: Subscription[] = [];
  const listFailures: ScriptedFailure[] = [];
  const writeFailures: ScriptedFailure[] = [];
  const removals: { readonly id: string; readonly reason: string | null }[] = [];
  let listCalls = 0;
  let writeCalls = 0;
  let pageSize = Number.POSITIVE_INFINITY;
  let endlessPages = false;
  let repeatAfterPages = Number.POSITIVE_INFINITY;
  let withheldDeltaLink = false;
  let honoursConditional = true;
  let rewritesBodies = false;
  let calendarsBody: unknown = null;
  let issuedLinks = 0;
  let issuedDeltaTokens = 0;
  let corruptRows = false;
  let deleteBodyCancelled = false;
  let unreadableRegistrations = false;

  const removalEntries = (): readonly unknown[] =>
    removals.map((removal) => {
      if (removal.reason === null) {
        return { id: removal.id, "@removed": {} };
      }
      return { id: removal.id, "@removed": { reason: removal.reason } };
    });

  const pageAt = (offset: number, everything: readonly unknown[]) => {
    const slice = everything.slice(offset, offset + pageSize);
    const consumed = offset + slice.length;
    return { slice, consumed, last: consumed >= everything.length };
  };

  const linkFor = (consumed: number, path: string): string => {
    issuedLinks += 1;
    if (endlessPages) {
      return `${graphRoot}/v1.0${path}?$skiptoken=cycling`;
    }
    if (issuedLinks > repeatAfterPages) {
      return `${graphRoot}/v1.0${path}?$skiptoken=repeated`;
    }
    return `${graphRoot}/v1.0${path}?$skiptoken=page-${consumed}`;
  };

  const matchingRows = (url: URL): readonly unknown[] => {
    const wanted = propertyFilterOf(url);
    const everything = [...stored, ...extras, ...removalEntries()];
    if (wanted === null) {
      return everything;
    }
    return everything.filter((item) => carriesProperty(item, wanted.id, wanted.value));
  };

  const listBody = (url: URL): unknown => {
    const offset = offsetOfToken(url.searchParams.get("$skiptoken"));
    const page = pageAt(offset, matchingRows(url));
    const base = { value: asGraphRetrieves(url, page.slice) };
    if (!page.last || endlessPages) {
      return { ...base, "@odata.nextLink": linkFor(page.consumed, url.pathname) };
    }
    if (withheldDeltaLink) {
      return base;
    }
    issuedDeltaTokens += 1;
    return {
      ...base,
      "@odata.deltaLink": `${graphRoot}/v1.0${url.pathname}?$deltatoken=d-${issuedDeltaTokens}`,
    };
  };

  const answerList = (url: URL): Response => {
    listCalls += 1;
    if (corruptRows) {
      return errorResponse({ onCall: listCalls, status: 410, code: "resyncRequired" });
    }
    const failure = scriptedFailureFor(listFailures, listCalls);
    if (failure !== null) {
      return errorResponse(failure);
    }
    return Response.json(listBody(url), { status: 200, headers: headersOf({}) });
  };

  const answerInstances = (masterId: string): Response => {
    listCalls += 1;
    if (failingInstances.has(masterId)) {
      return errorResponse({ onCall: listCalls, status: 500, code: "internalServerError" });
    }
    return Response.json(
      { value: instancesOf.get(masterId) ?? [] },
      { status: 200, headers: headersOf({}) },
    );
  };

  const answerCalendars = (): Response => {
    if (calendarsBody !== null) {
      return Response.json(calendarsBody, { status: 200, headers: headersOf({}) });
    }
    return Response.json(
      {
        value: [
          { id: options.calendarId, name: "Fake calendar", canEdit: true, isDefaultCalendar: true },
        ],
      },
      { status: 200, headers: headersOf({}) },
    );
  };

  const tombstonesFor = (events: readonly RemoteEvent[]): readonly GraphEvent[] => {
    const surviving = new Set(events.map((event) => event.id.value));
    const gone = new Map<string, GraphEvent>();
    for (const item of stored) {
      const id = idOfItem(item);
      if (id.length === 0 || surviving.has(id)) {
        continue;
      }
      gone.set(id, { ...item, isCancelled: true });
    }
    return [...gone.values()];
  };

  const positionOfId = (id: string): number => stored.findLastIndex((item) => idOfItem(item) === id);

  const itemWithId = (id: string): GraphEvent | null => stored.at(positionOfId(id)) ?? null;

  const rewritten = (item: GraphEvent): GraphEvent => {
    if (!rewritesBodies) {
      return item;
    }
    return {
      ...item,
      body: { contentType: "html", content: `<html><body>${item.body?.content ?? ""}</body></html>` },
    };
  };

  const answerRead = (url: URL, id: string): Response => {
    const found = itemWithId(id);
    if (!found) {
      return errorResponse({ onCall: writeCalls, status: 404, code: "ErrorItemNotFound" });
    }
    const retrieved = asGraphRetrieves(url, [rewritten(found)]).at(0) ?? null;
    return Response.json(retrieved, { status: 200, headers: headersOf({}) });
  };

  const insert = (body: unknown): Response => {
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, code: "ErrorInvalidRequest" });
    }
    const submitted: GraphEvent = body;
    const id = `graph-generated-${writeCalls}`;
    const created: GraphEvent = {
      ...submitted,
      id,
      iCalUId: `uid-${id}`,
      changeKey: `ck-1-${id}`,
      isCancelled: false,
      type: "singleInstance",
    };
    stored.push(created);
    return Response.json(rewritten(created), { status: 201, headers: headersOf({}) });
  };

  const patch = (id: string, body: unknown, ifMatch: string | null): Response => {
    const position = positionOfId(id);
    const existing = stored.at(position);
    if (position === -1 || !existing) {
      return errorResponse({ onCall: writeCalls, status: 404, code: "ErrorItemNotFound" });
    }
    if (honoursConditional && ifMatch !== null && ifMatch !== existing.changeKey) {
      return errorResponse({ onCall: writeCalls, status: 412, code: "ErrorIrresolvableConflict" });
    }
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, code: "ErrorInvalidRequest" });
    }
    const revision = Number.parseInt((existing.changeKey ?? "ck-1").split("-").at(1) ?? "1", 10) + 1;
    const next: GraphEvent = { ...existing, ...body, id, changeKey: `ck-${revision}-${id}` };
    stored.splice(position, 1, next);
    return Response.json(rewritten(next), { status: 200, headers: headersOf({}) });
  };

  const remove = (id: string, ifMatch: string | null): Response => {
    const existing = itemWithId(id);
    if (!existing) {
      return errorResponse({ onCall: writeCalls, status: 404, code: "ErrorItemNotFound" });
    }
    if (honoursConditional && ifMatch !== null && ifMatch !== existing.changeKey) {
      return errorResponse({ onCall: writeCalls, status: 412, code: "ErrorIrresolvableConflict" });
    }
    for (let position = stored.length - 1; position >= 0; position -= 1) {
      if (idOfItem(stored.at(position) ?? {}) === id) {
        stored.splice(position, 1);
      }
    }
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(" "));
        controller.close();
      },
      cancel: () => {
        deleteBodyCancelled = true;
      },
    });
    return new Response(stream, { status: 204, headers: headersOf({}) });
  };

  const createSubscription = (body: unknown): Response => {
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, code: "ErrorInvalidRequest" });
    }
    const requested: Subscription = body;
    const duplicate = openSubscriptions.find(
      (held) => held.resource === requested.resource && held.changeType === requested.changeType,
    );
    if (duplicate) {
      return errorResponse({
        onCall: writeCalls,
        status: 409,
        code: "ExtensionError",
      });
    }
    const created: Subscription = {
      ...requested,
      id: `subscription-${openSubscriptions.length + 1}`,
    };
    openSubscriptions.push(created);
    if (unreadableRegistrations) {
      const { id: _unreadable, ...withoutId } = created;
      return Response.json(withoutId, { status: 201, headers: headersOf({}) });
    }
    return Response.json(created, { status: 201, headers: headersOf({}) });
  };

  const patchSubscription = (id: string, body: unknown): Response => {
    const position = openSubscriptions.findIndex((held) => held.id === id);
    const existing = openSubscriptions.at(position);
    if (position === -1 || !existing) {
      return errorResponse({ onCall: writeCalls, status: 404, code: "ResourceNotFound" });
    }
    if (typeof body !== "object" || body === null) {
      return errorResponse({ onCall: writeCalls, status: 400, code: "ErrorInvalidRequest" });
    }
    const next: Subscription = { ...existing, ...body };
    openSubscriptions.splice(position, 1, next);
    return Response.json(next, { status: 200, headers: headersOf({}) });
  };

  const deleteSubscriptionRow = (id: string): Response => {
    const position = openSubscriptions.findIndex((held) => held.id === id);
    if (position === -1) {
      return errorResponse({ onCall: writeCalls, status: 404, code: "ResourceNotFound" });
    }
    openSubscriptions.splice(position, 1);
    return new Response(null, { status: 204, headers: headersOf({}) });
  };

  const answerSubscriptions = (method: string, url: URL, body: unknown): Response => {
    if (method === "GET") {
      return Response.json({ value: openSubscriptions }, { status: 200, headers: headersOf({}) });
    }
    writeCalls += 1;
    const scripted = scriptedFailureFor(writeFailures, writeCalls);
    if (scripted !== null) {
      return errorResponse(scripted);
    }
    if (method === "POST") {
      return createSubscription(body);
    }
    if (method === "PATCH") {
      return patchSubscription(subscriptionIdOf(url.pathname), body);
    }
    if (method === "DELETE") {
      return deleteSubscriptionRow(subscriptionIdOf(url.pathname));
    }
    return errorResponse({ onCall: writeCalls, status: 405, code: "ErrorInvalidRequest" });
  };

  const answerWrite = (
    method: string,
    url: URL,
    body: unknown,
    ifMatch: string | null,
  ): Response => {
    writeCalls += 1;
    const failure = scriptedFailureFor(writeFailures, writeCalls);
    if (failure !== null) {
      return errorResponse(failure);
    }
    if (method === "POST") {
      return insert(body);
    }
    if (method === "PATCH") {
      return patch(eventIdOf(url.pathname), body, ifMatch);
    }
    if (method === "DELETE") {
      return remove(eventIdOf(url.pathname), ifMatch);
    }
    return errorResponse({ onCall: writeCalls, status: 405, code: "ErrorInvalidRequest" });
  };

  const answer = (method: string, url: URL, body: unknown, ifMatch: string | null): Response => {
    if (url.pathname.includes("/subscriptions")) {
      return answerSubscriptions(method, url, body);
    }
    if (method === "GET" && url.pathname.endsWith("/instances")) {
      return answerInstances(eventIdOf(url.pathname));
    }
    if (method === "GET" && url.pathname.includes("/calendarView")) {
      return answerList(url);
    }
    if (method === "GET" && url.pathname.endsWith("/calendars")) {
      return answerCalendars();
    }
    if (method === "GET" && url.pathname.includes("/events/")) {
      return answerRead(url, eventIdOf(url.pathname));
    }
    if (method === "GET" && url.pathname.endsWith("/events")) {
      return answerList(url);
    }
    return answerWrite(method, url, body, ifMatch);
  };

  const fakeFetch: FetchImplementation = async (input, init) => {
    const request = requestOf(input, init);
    const url = new URL(request.url);
    const ifMatch = request.headers.get("if-match");
    const prefer = request.headers.get("prefer");
    const body = await bodyOf(request);
    recorded.push({
      method: request.method,
      path: url.pathname,
      search: searchOf(url),
      prefer,
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
      extras.length = 0;
      removals.length = 0;
      corruptRows = seed.corruptKnownRows.length > 0;
      for (const event of seed.events) {
        stored.push(itemOfRemoteEvent(event, options.startedAt));
      }
      stored.push(...vanished);
      for (const uid of seed.cancelled) {
        for (const [position, item] of stored.entries()) {
          if (item.iCalUId === uid.value) {
            stored.splice(position, 1, { ...item, isCancelled: true });
          }
        }
      }
      for (const id of seed.unattributableRemovals) {
        removals.push({ id: id.value, reason: null });
      }
    },
    putItems: (items: readonly GraphEvent[]) => {
      stored.push(...items);
    },
    putRaw: (items: readonly unknown[]) => {
      extras.push(...items);
    },
    putInstances: (masterId: string, instances: readonly GraphEvent[]) => {
      instancesOf.set(masterId, instances);
    },
    failInstancesFor: (masterId: string) => {
      failingInstances.add(masterId);
    },
    items: () => [...stored],
    requests: () => [...recorded],
    listCallCount: () => listCalls,
    writeCallCount: () => writeCalls,
    subscriptions: () => [...openSubscriptions],
    putSubscription: (subscription: Subscription) => {
      openSubscriptions.push(subscription);
    },
    failListOn: (failure: ScriptedFailure) => {
      listFailures.push(failure);
    },
    failWriteOn: (failure: ScriptedFailure) => {
      writeFailures.push(failure);
    },
    answerCalendarsWith: (body: unknown) => {
      calendarsBody = body;
    },
    pageEvery: (size: number) => {
      pageSize = size;
    },
    cyclesNextLink: () => {
      endlessPages = true;
    },
    repeatsLinkAfter: (pages: number) => {
      repeatAfterPages = pages;
    },
    withholdDeltaLink: () => {
      withheldDeltaLink = true;
    },
    honoursIfMatch: (honours: boolean) => {
      honoursConditional = honours;
    },
    rewritesBody: (rewrites: boolean) => {
      rewritesBodies = rewrites;
    },
    mutateItem: (id: string, item: GraphEvent) => {
      const position = positionOfId(id);
      const existing = stored.at(position);
      if (position === -1 || !existing) {
        return;
      }
      const revision = Number.parseInt((existing.changeKey ?? "ck-1").split("-").at(1) ?? "1", 10) + 1;
      stored.splice(position, 1, { ...existing, ...item, changeKey: `ck-${revision}-${id}` });
    },
    removeItem: (id: string, reason: string | null) => {
      const position = positionOfId(id);
      if (position !== -1) {
        stored.splice(position, 1);
      }
      removals.push({ id, reason });
    },
    deleteBodyWasCancelled: () => deleteBodyCancelled,
    withholdSubscriptionId: () => {
      unreadableRegistrations = true;
    },
  };
};

export { createFakeGraph, errorBodyShapes, graphErrorBody, graphRoot, hostileBodies };
export type { ErrorBodyShape, FakeGraph, FakeGraphOptions, RecordedRequest, ScriptedFailure };

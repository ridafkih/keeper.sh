import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSyncOperations, executeRemoteOperations } from "@keeper.sh/calendar";
import { createOutlookSyncProvider } from "@keeper.sh/calendar/outlook";
import type { EventMapping, MaterializedSyncableEvent } from "@keeper.sh/calendar";
import {
  createDestinationReconciliationScope,
  readDestinationRemoteEvents,
  TARGETED_DESTINATION_READ_LIMIT,
} from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-cal-1";
const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

/* Graph re-keys an item in place: the id the mapping holds dies, the iCalUId survives. */
const MAPPED_ID = "AAMkAGmirror-as-mapped";
const MOVED_ID = "AAMkAGmirror-after-the-re-key";
const MIRROR_UID = "keeper-uid-rekeyed@keeper.sh";
const REKEYED_MAPPING_ID = "mapping-0";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-10-01T00:00:00.000Z"),
  timeMin: new Date("2026-08-01T00:00:00.000Z"),
};

/*
 * The push plan has to be larger than the by-id budget for the run to take the windowed listing,
 * which is the only path that verifies an unconfirmed mapping - and so the only path on which a
 * re-keyed mirror is ever found again. One cycle of a normal mailbox is exactly that size.
 */
const MAPPED_EVENT_COUNT = TARGETED_DESTINATION_READ_LIMIT + 1;

const createStartTime = (index: number): Date =>
  new Date(Date.UTC(2026, 8, 1, 9, 0, 0) + index * 60 * 60 * 1000);

const createEndTime = (index: number): Date =>
  new Date(createStartTime(index).getTime() + 60 * 60 * 1000);

const toGraphDateTime = (value: Date): string =>
  `${value.toISOString().replace("Z", "")}0000`;

const createMirrorId = (index: number): string => `AAMkAGmirror-${index}`;

const createMirrorUid = (index: number): string => `keeper-uid-${index}@keeper.sh`;

/* The source edit every mapping is still carrying: the summary the destination has not received. */
const createLocalEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Work",
  calendarUrl: null,
  endTime: createEndTime(index),
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: createStartTime(index),
  summary: `Quarterly review ${index} — moved to Thursday`,
});

const createMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: createMirrorId(index),
  destinationEventUid: createMirrorUid(index),
  endTime: createEndTime(index),
  eventStateId: `sync-event-${index}`,
  id: `mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createStartTime(index),
  syncEventHash: "hash-recorded-before-the-source-edit",
  syncEventId: `sync-event-${index}`,
});

const localEvents = Array.from({ length: MAPPED_EVENT_COUNT }, (unused, index) =>
  createLocalEvent(index));

/* Mapping 0 is the one Graph re-keyed, so its stored id is the dead one. */
const existingMappings = localEvents.map((unused, index) => {
  if (index !== 0) {
    return createMapping(index);
  }
  return { ...createMapping(0), deleteIdentifier: MAPPED_ID, destinationEventUid: MIRROR_UID };
});

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  /*
   * Graph's windowed page over a calendar is served from an index that has not caught up with an
   * in-place re-key: the item is live, addressable by id and findable by iCalUId, but the listing
   * that names the sync window does not offer it. That gap is the whole reason the run reaches
   * verification for a mirror that never went anywhere.
   */
  missingFromWindowedListing: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const createMailboxEvent = (index: number): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: toGraphDateTime(createEndTime(index)), timeZone: "UTC" },
  folderId: DESTINATION_FOLDER_ID,
  iCalUId: createMirrorUid(index),
  id: createMirrorId(index),
  isAllDay: false,
  missingFromWindowedListing: false,
  showAs: "busy",
  start: { dateTime: toGraphDateTime(createStartTime(index)), timeZone: "UTC" },
  subject: `Quarterly review ${index}`,
});

const createMailbox = (): MailboxEvent[] => {
  const held = localEvents.map((unused, index) => createMailboxEvent(index));
  const [rekeyed] = held;
  if (rekeyed) {
    rekeyed.iCalUId = MIRROR_UID;
    rekeyed.id = MOVED_ID;
    rekeyed.missingFromWindowedListing = true;
  }
  return held;
};

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const readDirectEventId = (url: URL): string | null => {
  const segments = readPathSegments(url);
  const eventsIndex = segments.lastIndexOf("events");
  if (eventsIndex === -1) {
    return null;
  }
  const identifier = segments[eventsIndex + 1];
  if (!identifier) {
    return null;
  }
  return decodeURIComponent(identifier);
};

/* A folder-scoped listing answers only about the folder its own path names. */
const readAddressedFolderId = (url: URL): string => {
  const segments = readPathSegments(url);
  const calendarsIndex = segments.lastIndexOf("calendars");
  if (calendarsIndex === -1) {
    return DEFAULT_FOLDER_ID;
  }
  const folderId = segments[calendarsIndex + 1];
  if (!folderId) {
    return DEFAULT_FOLDER_ID;
  }
  return decodeURIComponent(folderId);
};

const isCalendarListRead = (url: URL): boolean => readPathSegments(url).at(-1) === "calendars";

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const readPatchedSubject = (body: string | null): string | null => {
  if (!body) {
    return null;
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("subject" in parsed)) {
    return null;
  }
  const { subject } = parsed as { subject?: unknown };
  if (typeof subject !== "string") {
    return null;
  }
  return subject;
};

/* A synthetic Graph mailbox: an item id addresses exactly one item mailbox-wide, a calendar-scoped
   listing answers only about its own folder, DELETE really removes and POST really appends. */
const installGraphMailbox = (held: MailboxEvent[]): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = readRequestBody(init);
    requests.push({ body, method, url: url.toString() });

    const directId = readDirectEventId(url);

    if (method === "DELETE") {
      const index = held.findIndex((event) => event.id === directId);
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => event.id === directId);
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const subject = readPatchedSubject(body);
      if (subject) {
        target.subject = subject;
      }
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const created: MailboxEvent = {
        ...createMailboxEvent(0),
        folderId: readAddressedFolderId(url),
        iCalUId: "created-uid",
        id: "AAMkAGcreated",
      };
      held.push(created);
      return Promise.resolve(Response.json(created));
    }

    if (isCalendarListRead(url)) {
      return Promise.resolve(Response.json({
        value: [{ id: DESTINATION_FOLDER_ID }, { id: DEFAULT_FOLDER_ID }],
      }));
    }

    if (directId) {
      const found = held.find((event) => event.id === directId);
      if (!found) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(found));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    /* The uid filter reads the folder itself, so it sees the re-keyed item the window page missed. */
    if (uid) {
      return Promise.resolve(Response.json({
        value: held.filter((event) => event.folderId === folderId && event.iCalUId === uid),
      }));
    }
    return Promise.resolve(Response.json({
      value: held.filter(
        (event) => event.folderId === folderId && !event.missingFromWindowedListing,
      ),
    }));
  }));

  return requests;
};

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: DESTINATION_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const EVENT_READ_DIAGNOSTICS = {
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [] as string[],
  overBudgetSourceEventUids: [] as string[],
  syncableEventCount: 0,
};

/* The real chain: the destination read sync-user performs, the plan it computes from exactly what
   that read returned, and the writes the engine issues for that plan. */
const runOneDestinationCycle = async (provider: ReturnType<typeof createProvider>) => {
  const read = await readDestinationRemoteEvents({
    existingMappings,
    localEvents,
    provider,
    requestedWindow: REQUESTED_WINDOW,
  });
  const scope = createDestinationReconciliationScope({
    authoritativeMappingIds: read.authoritativeMappingIds,
    authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, REQUESTED_WINDOW]]),
    authoritativeWindow: REQUESTED_WINDOW,
    eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
    requestedWindow: REQUESTED_WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    unverifiedMappingIds: read.verification?.unverifiedMappingIds ?? new Set<string>(),
  });
  const { operations } = computeSyncOperations(
    localEvents,
    existingMappings,
    read.remoteEvents,
    scope,
  );
  return await executeRemoteOperations(
    operations,
    existingMappings,
    DESTINATION_CALENDAR_ID,
    provider,
  );
};

const namesEventId = (request: GraphRequest, eventId: string): boolean =>
  request.url.includes(eventId);

describe("a re-keyed Outlook mirror is never deleted by the verification that just found it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("repairs the mirror in place instead of destroying and re-creating it", async () => {
    const held = createMailbox();
    const requests = installGraphMailbox(held);

    const outcome = await runOneDestinationCycle(createProvider());

    /* A DELETE here takes the customer's live event with its RSVPs, reminders and categories, and
       the POST that follows is a create-only duplicate that nothing ever reaps. */
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(requests.filter((request) => request.method === "POST")).toEqual([]);

    const patchesAtMirror = requests.filter(
      (request) =>
        request.method === "PATCH"
        && (namesEventId(request, MOVED_ID) || namesEventId(request, MAPPED_ID)),
    );
    expect(patchesAtMirror).toHaveLength(1);
    expect(patchesAtMirror[0]?.url).toContain(MOVED_ID);

    /* The pending source edit lands on the mirror that was there all along. */
    expect(held.find((event) => event.id === MOVED_ID)?.subject)
      .toBe(localEvents[0]?.summary);
    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
  });

  it("rewrites the mapping to the id the read actually saw", async () => {
    installGraphMailbox(createMailbox());

    const outcome = await runOneDestinationCycle(createProvider());

    expect(outcome.changes.updates ?? []).toContainEqual(
      expect.objectContaining({ deleteIdentifier: MOVED_ID, id: REKEYED_MAPPING_ID }),
    );
  });
});

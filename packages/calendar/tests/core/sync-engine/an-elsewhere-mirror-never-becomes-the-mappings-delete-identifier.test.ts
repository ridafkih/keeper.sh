import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import type { PendingChanges, PendingUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
/* The sync writes into a calendar the customer created, so a folder-scoped listing is the only read
   that answers about the calendar this sync owns. */
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const REKEYED_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const makeMailboxEvent = (id: string, iCalUId: string, folderId: string): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId,
  iCalUId,
  id,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: MAPPED_SUBJECT,
});

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

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

/* /me/events addresses the mailbox default collection; only /me/calendars/{id}/events addresses the
   folder the sync writes to. */
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

const isCalendarListRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "calendars";
};

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
  const parsed = JSON.parse(body) as { subject?: unknown };
  if (typeof parsed.subject !== "string") {
    return null;
  }
  return parsed.subject;
};

interface Mailbox {
  held: MailboxEvent[];
  requests: GraphRequest[];
}

/* A synthetic Graph mailbox with the real shape: an item id addresses one event mailbox-wide, a
   listing only ever answers about the folder its URL names, and a DELETE really removes the item
   and answers 204 -- which is precisely how the customer's only copy disappears for good. */
const installGraphMailbox = (events: MailboxEvent[]): Mailbox => {
  const requests: GraphRequest[] = [];
  const held = [...events];

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
      const created = makeMailboxEvent(
        "AAMkAGcreated",
        "created-uid",
        readAddressedFolderId(url),
      );
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
    const matched = held.filter((event) => event.folderId === folderId && event.iCalUId === uid);
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return { held, requests };
};

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: DESTINATION_FOLDER_ID,
    calendarId: DESTINATION_CALENDAR_ID,
    userId: "user-1",
  });

/* The customer renamed the meeting after dragging their copy into the mailbox default folder, so
   the first cycle carries a real pending edit. */
const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: EDITED_SUBJECT,
};

const mappedEvent: MaterializedSyncableEvent = { ...localEvent, summary: MAPPED_SUBJECT };

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent),
  syncEventId: "sync-event-1",
};

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

/* The plan is small, so sync-user takes the targeted getRemoteEventsByIds branch: the dead id 404s,
   that branch never verifies, and the mapping reaches reconciliation as remoteMissing. */
const TARGETED_READ_SCOPE = {
  authoritativeMappingIds: new Set([MAPPING_ID]),
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

interface CycleOutcome {
  patches: GraphRequest[];
  requests: GraphRequest[];
  updates: PendingUpdate[];
}

const runCycle = async (
  localEvents: MaterializedSyncableEvent[],
  mappings: EventMapping[],
  mailbox: Mailbox,
): Promise<CycleOutcome> => {
  const before = mailbox.requests.length;
  const checkpointed: PendingChanges[] = [];
  const { operations } = computeSyncOperations(
    localEvents,
    mappings,
    [],
    TARGETED_READ_SCOPE,
  );

  const outcome = await executeRemoteOperations(
    operations,
    mappings,
    DESTINATION_CALENDAR_ID,
    createProvider(),
    globalThis.undefined,
    globalThis.undefined,
    (changes: PendingChanges) => {
      checkpointed.push(changes);
      return Promise.resolve(true);
    },
  );

  const madeRequests = mailbox.requests.slice(before);
  const checkpointedUpdates = checkpointed.flatMap((changes) => changes.updates ?? []);
  return {
    patches: requestsOfMethod(madeRequests, "PATCH"),
    requests: madeRequests,
    updates: [...(outcome.changes.updates ?? []), ...checkpointedUpdates],
  };
};

/* Production's flush.ts toMappingUpdateValues writes deleteIdentifier unconditionally, so the repair
   here is exactly as generous as production: whatever identifier the run put on the update lands on
   the mapping, and from there it is the identifier the remove path deletes by. */
const applyRepairs = (existing: EventMapping, updates: PendingUpdate[]): EventMapping => {
  const repair = updates.find((update) => update.id === existing.id);
  if (!repair) {
    return existing;
  }
  return {
    ...existing,
    deleteIdentifier: repair.deleteIdentifier,
    destinationEventUid: repair.destinationEventUid ?? existing.destinationEventUid,
    syncEventHash: repair.syncEventHash,
  };
};

const holdsIdentifier = (mailbox: Mailbox, identifier: string): boolean =>
  mailbox.held.some((event) => event.id === identifier);

const addressesIdentifier = (request: GraphRequest, identifier: string): boolean =>
  request.url.includes(identifier);

describe("an elsewhere mirror never becomes the mapping's delete identifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* The item the "elsewhere" verdict located lives in the customer's own default calendar. Outlook's
     deleteEvents is an unconditional mailbox-wide DELETE /me/events/{id}, so the moment that id sits
     on mapping.deleteIdentifier the next removal cycle destroys the customer's only copy. */
  it("issues no DELETE against the located id when the source event later disappears", async () => {
    const mailbox = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID),
    ]);

    const first = await runCycle([localEvent], [mapping], mailbox);
    const persisted = applyRepairs(mapping, first.updates);

    /* The source event is gone this cycle, so the mapping is planned for removal. */
    const { operations } = computeSyncOperations([], [persisted], [], TARGETED_READ_SCOPE);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ mappingId: MAPPING_ID, type: "remove" });

    const second = await runCycle([], [persisted], mailbox);

    expect(requestsOfMethod(second.requests, "DELETE")).toEqual([]);
    /* The customer's only copy is still sitting in their own calendar, where they dragged it. */
    expect(holdsIdentifier(mailbox, REKEYED_ID)).toBe(true);
  });

  /* Secondary harm, same root cause: an identifier only ever seen outside the destination calendar
     is never in the destination listing, so the mapping re-plans as remoteMissing every cycle and
     keeps PATCHing the customer's out-of-destination event forever. */
  it("does not keep writing to an out-of-destination id on every steady-state cycle", async () => {
    const mailbox = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID),
    ]);

    const first = await runCycle([localEvent], [mapping], mailbox);
    const persisted = applyRepairs(mapping, first.updates);

    const second = await runCycle([localEvent], [persisted], mailbox);
    const third = await runCycle([localEvent], [persisted], mailbox);

    expect(second.patches.filter((patch) => addressesIdentifier(patch, REKEYED_ID))).toEqual([]);
    expect(third.patches.filter((patch) => addressesIdentifier(patch, REKEYED_ID))).toEqual([]);
  });
});

import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
/* The paying customer syncs into a calendar they created, not the mailbox default, so a folder-scoped
   listing is the only read that answers about the calendar this sync actually writes to. */
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const REKEYED_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";

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

/* A synthetic Graph mailbox with the real shape: an item id addresses one event mailbox-wide, a
   listing only ever answers about the folder its URL names, and a DELETE really removes the item. */
const installGraphMailbox = (events: MailboxEvent[]): GraphRequest[] => {
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

  return requests;
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

/* The source moved the meeting after Graph re-keyed the mirror, so this run carries a real customer
   edit that has to land on whatever the destination still holds. */
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
  id: "mapping-1",
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent),
  syncEventId: "sync-event-1",
};

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

/* The plan is small, so sync-user takes the targeted getRemoteEventsByIds branch: the stale id 404s,
   that branch never verifies, and the mapping reaches reconciliation as remoteMissing. */
const TARGETED_READ_SCOPE = {
  authoritativeMappingIds: new Set(["mapping-1"]),
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const LISTING_SCOPE = {
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const liveRemoteEvent: RemoteEvent = {
  deleteId: REKEYED_ID,
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  uid: MIRROR_UID,
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const requestsTouching = (requests: GraphRequest[], method: string, identifier: string): GraphRequest[] =>
  requestsOfMethod(requests, method).filter((request) => request.url.includes(identifier));

describe("a verification that located the mirror repairs the mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* Shape (a): the targeted read 404s on the dead id, verification positively locates the mirror at
     its new id, and today that observation is discarded — the run reports a clean no-op forever
     while the source keeps changing and the mirror stays frozen. */
  it("writes the located id back onto the mapping and delivers the pending edit to it", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
    ]);

    const { operations } = computeSyncOperations([localEvent], [mapping], [], TARGETED_READ_SCOPE);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ remoteMissing: true, type: "replace" });

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    expect(outcome.changes.updates ?? []).toContainEqual(
      expect.objectContaining({ deleteIdentifier: REKEYED_ID, id: "mapping-1" }),
    );

    const patches = requestsTouching(requests, "PATCH", REKEYED_ID);
    expect(patches).toHaveLength(1);
    expect(readPatchedSubject(patches[0]?.body ?? null)).toBe(EDITED_SUBJECT);

    expect(outcome.errors).toEqual([]);
    // Outlook's create is a create-only POST, so any create here is a permanent duplicate.
    expect(requestsOfMethod(requests, "POST")).toEqual([]);
  });

  /* Shape (b): the full windowed listing returns the live mirror under its new id. Unmapped, it
     reads as an orphan, removes sort ahead of replaces, and the customer's live event is DELETEd
     and re-POSTed — reminders, categories and RSVP state destroyed on a create-only provider. */
  it("never deletes and recreates the live mirror the listing returned", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
    ]);

    const { operations } = computeSyncOperations(
      [localEvent],
      [mapping],
      [liveRemoteEvent],
      LISTING_SCOPE,
    );

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    expect(requestsTouching(requests, "DELETE", REKEYED_ID)).toEqual([]);
    expect(requestsOfMethod(requests, "POST")).toEqual([]);
    expect(outcome.changes.updates ?? []).toContainEqual(
      expect.objectContaining({ deleteIdentifier: REKEYED_ID, id: "mapping-1" }),
    );
    expect(outcome.result.removed).toBe(0);
    expect(outcome.result.added).toBe(0);
  });

  /* Once repaired, the next cycle has to recognise the same live event, or the pair oscillates
     between repair and orphan-removal forever. */
  it("emits no orphan remove on the cycle after the mapping learned the live id", () => {
    const repaired: EventMapping = { ...mapping, deleteIdentifier: REKEYED_ID };

    const { operations } = computeSyncOperations(
      [localEvent],
      [repaired],
      [liveRemoteEvent],
      LISTING_SCOPE,
    );

    expect(operations.filter((operation) => operation.type === "remove")).toEqual([]);
  });
});

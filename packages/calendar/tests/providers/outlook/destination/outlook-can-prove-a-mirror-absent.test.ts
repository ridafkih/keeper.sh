import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
/* The paying customer syncs into a calendar they created, not the mailbox default, so a mailbox-wide
   read answers about a folder the sync never writes to. */
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const REKEYED_ID = "AAMkAGmirror-after-graph-rekeyed-it";
const MIRROR_UID = "mirror-uid-1";

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
  subject: "Quarterly review",
});

interface GraphRequest {
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

/* /me/events addresses the default calendar collection; only /me/calendars/{id}/events addresses
   the folder the sync actually writes to. */
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

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

const throttledResponse = (): Response =>
  Response.json(
    { error: { code: "ApplicationThrottled", message: "ApplicationThrottled from Graph." } },
    { headers: { "Retry-After": "0" }, status: 429 },
  );

interface MailboxOptions {
  throttleFilterReads?: boolean;
}

/* A synthetic mailbox with real Graph shape: an item id addresses one event mailbox-wide, but a
   listing only ever answers about the folder its URL names. */
const installGraphMailbox = (
  events: MailboxEvent[],
  options: MailboxOptions = {},
): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ method, url: url.toString() });

    if (method !== "GET") {
      return Promise.resolve(Response.json(
        makeMailboxEvent("AAMkAGcreated", "created-uid", readAddressedFolderId(url)),
      ));
    }

    const directId = readDirectEventId(url);
    if (directId) {
      const held = events.find((event) => event.id === directId);
      if (!held) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(held));
    }

    if (options.throttleFilterReads) {
      return Promise.resolve(throttledResponse());
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = events.filter(
      (event) => event.folderId === folderId && event.iCalUId === uid,
    );
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

/* The engine names a mirror by the id a delete would target plus the uid the mapping already
   carries; Outlook needs both to tell a re-keyed mirror from a deleted one. */
interface VerificationTarget {
  deleteId: string;
  uid: string;
}

const verifyTargets = (targets: VerificationTarget[]): Promise<EventPresence[]> => {
  const { verifyEventsExist } = createProvider();
  const verify = verifyEventsExist as unknown as (
    targets: VerificationTarget[],
  ) => Promise<EventPresence[]>;
  return verify(targets);
};

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
};

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: "mapping-1",
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(localEvent),
  syncEventId: "sync-event-1",
};

const RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const planMissingMirrorReplacement = () => {
  // The mirror is missing from the windowed listing, so reconciliation can only plan a replacement.
  const { operations } = computeSyncOperations([localEvent], [mapping], [], RECONCILIATION_SCOPE);
  expect(operations).toHaveLength(1);
  expect(operations[0]?.type).toBe("replace");
  return operations;
};

const reconcileMissingMirror = () =>
  executeRemoteOperations(
    planMissingMirrorReplacement(),
    [mapping],
    DESTINATION_CALENDAR_ID,
    createProvider(),
  );

const postedRequests = (requests: GraphRequest[]): GraphRequest[] =>
  requests.filter((request) => request.method === "POST");

describe("Outlook can prove a mirror absent, and looks in the destination calendar to do it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* Absence by omission is what main proved, and what restored the event. A mirror that can never
     be called absent is silently gone forever while later source edits never reach it. */
  it("restores a mirror the recipient really deleted", async () => {
    const requests = installGraphMailbox([]);

    const outcome = await reconcileMissingMirror();

    expect(outcome.result.added).toBe(1);
    expect(postedRequests(requests)).toHaveLength(1);
  });

  it("reports a mirror the recipient really deleted as absent", async () => {
    installGraphMailbox([]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toEqual([{ identifier: MAPPED_ID, status: "absent" }]);
  });

  /* Graph re-keys an item, so the dead item id proves nothing: the uid still names a live mirror
     and Outlook's create is a create-only POST that would leave a permanent duplicate. */
  it("reports a re-keyed mirror still in the destination calendar as present, and recreates nothing", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
    ]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ identifier: MAPPED_ID, status: "present" });
    expect(report[0]?.event?.deleteId).toBe(REKEYED_ID);

    const outcome = await reconcileMissingMirror();

    expect(outcome.result.added).toBe(0);
    expect(postedRequests(requests)).toEqual([]);
  });

  /* The destination is not the mailbox default, so a uid read against /me/events sees an empty
     default calendar and calls a live mirror gone. */
  it("never reports a live mirror in a non-default destination calendar as absent", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
      makeMailboxEvent("AAMkAGunrelated", "unrelated-uid", DEFAULT_FOLDER_ID),
    ]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report[0]?.status).not.toBe("absent");

    const outcome = await reconcileMissingMirror();

    expect(outcome.result.added).toBe(0);
    expect(postedRequests(requests)).toEqual([]);
  });

  it("answers unknown when the uid read is throttled", async () => {
    const requests = installGraphMailbox([], { throttleFilterReads: true });

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toEqual([{ identifier: MAPPED_ID, status: "unknown" }]);
    expect(postedRequests(requests)).toEqual([]);
  });

  /* Two events under one uid name no single object, so nothing here is an observation of the
     mapped mirror and neither absence nor presence is proven. */
  it("answers unknown when the uid read matches more than one event", async () => {
    installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
      makeMailboxEvent("AAMkAGsecond-copy", MIRROR_UID, DESTINATION_FOLDER_ID),
    ]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toEqual([{ identifier: MAPPED_ID, status: "unknown" }]);
  });
});

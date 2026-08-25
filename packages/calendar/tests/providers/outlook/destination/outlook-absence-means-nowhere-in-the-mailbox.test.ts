import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
/* The mailbox holds three folders: the default one the sync never writes to, the destination the
   sync owns, and the folder the recipient drags a mirror into. */
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const DESTINATION_FOLDER_ID = "external-cal-1";
const OTHER_FOLDER_ID = "external-cal-2";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const MOVED_ID = "AAMkAGmirror-after-the-move";
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

/* Graph answers a listing about exactly the folder its path names, and /me/events names the
   mailbox default calendar only — never the whole mailbox. */
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

const isCalendarCollectionRead = (url: URL): boolean => {
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

const mailboxCalendars = [
  { id: DEFAULT_FOLDER_ID, isDefaultCalendar: true, name: "Calendar" },
  { id: DESTINATION_FOLDER_ID, isDefaultCalendar: false, name: "Keeper" },
  { id: OTHER_FOLDER_ID, isDefaultCalendar: false, name: "Personal" },
];

/* A synthetic mailbox with real Graph shape: an item id addresses one event mailbox-wide, but a
   listing only ever answers about the folder its own URL names. */
const installGraphMailbox = (events: MailboxEvent[]): GraphRequest[] => {
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

    if (isCalendarCollectionRead(url)) {
      return Promise.resolve(Response.json({ value: mailboxCalendars }));
    }

    const directId = readDirectEventId(url);
    if (directId) {
      const held = events.find((event) => event.id === directId);
      if (!held) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(held));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = events.filter(
      (event) => event.folderId === folderId && (uid === null || event.iCalUId === uid),
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

/* The engine names a mirror by the id a delete would target plus the uid the mapping carries;
   Outlook needs both to tell a moved mirror from a deleted one. */
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
  // The moved copy left the synced folder, so the windowed listing can only call the mirror missing.
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

describe("Outlook calls a mirror absent only when the uid names nothing anywhere in the mailbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* The recipient dragged the mirror into another folder of the same mailbox. Outlook's push is a
     create-only POST, so a create decided here is a permanent duplicate nothing ever reaps. */
  it("never reports a mirror moved to another calendar of the mailbox as absent", async () => {
    installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID, OTHER_FOLDER_ID)]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]?.status).not.toBe("absent");
  });

  it("creates nothing when the engine reconciles a mirror that moved to another calendar", async () => {
    const requests = installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID, OTHER_FOLDER_ID)]);

    const outcome = await reconcileMissingMirror();

    expect(postedRequests(requests)).toEqual([]);
    expect(outcome.result.added).toBe(0);
  });

  /* A mirror found outside the destination is not the same observation as one found inside it: the
     sync still has to move or re-adopt it, so the two must stay distinguishable. */
  it("distinguishes a mirror found elsewhere in the mailbox from one found in the destination", async () => {
    installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID, OTHER_FOLDER_ID)]);
    const moved = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);
    vi.unstubAllGlobals();

    installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID, DESTINATION_FOLDER_ID)]);
    const inPlace = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(inPlace[0]?.status).toBe("present");
    expect(moved[0]?.status).not.toBe("absent");
    expect(moved[0]?.status).not.toBe(inPlace[0]?.status);
  });

  /* Absence has to stay provable, or a mirror the recipient really deleted is silently gone forever
     while later source edits never reach it. */
  it("still reports a mirror deleted from the whole mailbox as absent, and restores it", async () => {
    const requests = installGraphMailbox([]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toEqual([{ identifier: MAPPED_ID, status: "absent" }]);

    const outcome = await reconcileMissingMirror();

    expect(outcome.result.added).toBe(1);
    expect(postedRequests(requests)).toHaveLength(1);
  });

  /* The destination is not the mailbox default, so a read of /me/events answers about a folder the
     sync never writes to and would call a live mirror gone. */
  it("never reports a live mirror in a non-default destination calendar as absent", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(MOVED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
      makeMailboxEvent("AAMkAGunrelated", "unrelated-uid", DEFAULT_FOLDER_ID),
    ]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report[0]?.status).not.toBe("absent");

    const outcome = await reconcileMissingMirror();

    expect(outcome.result.added).toBe(0);
    expect(postedRequests(requests)).toEqual([]);
  });
});

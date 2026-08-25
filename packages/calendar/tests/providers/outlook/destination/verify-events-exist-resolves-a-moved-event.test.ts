import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* Graph rewrites the item id when the recipient drags a mirror into another calendar of the same
   mailbox. The iCalUId survives the move, so it is the only handle that still names the object. */
const MAPPED_ID = "AAMkAGmirror-as-mapped";
const MOVED_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";
const REMOVED_ID = "AAMkAGmirror-the-recipient-deleted";
const REMOVED_UID = "mirror-uid-2";

/* The identifier the engine holds for a mirror is a pair: the id a delete would target and the uid
   the mapping already carries. Outlook needs both to tell a moved event from a deleted one. */
interface VerificationTarget {
  deleteId: string;
  uid: string;
}

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const makeMailboxEvent = (id: string, iCalUId: string): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
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

const readDirectEventId = (url: URL): string | null => {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
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

/* A synthetic mailbox: an item id addresses exactly one event and a listing answers only what its
   own filter names, so the folder listing never sees the event that moved out of the folder. */
const installGraphMailbox = (events: MailboxEvent[]): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ method, url: url.toString() });

    if (method !== "GET") {
      return Promise.resolve(Response.json(makeMailboxEvent("AAMkAGcreated", "created-uid")));
    }

    const directId = readDirectEventId(url);
    if (directId) {
      const held = events.find((event) => event.id === directId);
      if (!held) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(held));
    }

    const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
    const matched = events.filter((event) => filter.includes(event.iCalUId));
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return requests;
};

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: "external-cal-1",
    calendarId: DESTINATION_CALENDAR_ID,
    userId: "user-1",
  });

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

describe("Outlook resolves a moved mirror by iCalUId before concluding anything", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a mirror that Graph re-keyed on a cross-folder move as present", async () => {
    const requests = installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID)]);

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ identifier: MAPPED_ID, status: "present" });
    expect(report[0]?.event?.deleteId).toBe(MOVED_ID);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("still reports a mirror the recipient really deleted as absent", async () => {
    installGraphMailbox([]);

    const report = await verifyTargets([{ deleteId: REMOVED_ID, uid: REMOVED_UID }]);

    expect(report).toEqual([{ identifier: REMOVED_ID, status: "absent" }]);
  });

  /* Outlook's create is a create-only POST, so a create decided against a live-but-moved event is a
     duplicate on a paying customer's calendar that nothing ever reaps. */
  it("creates nothing when the engine reconciles a mirror that only moved", async () => {
    const requests = installGraphMailbox([makeMailboxEvent(MOVED_ID, MIRROR_UID)]);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(),
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    expect(requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(outcome.result.added).toBe(0);
  });
});

import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const DESTINATION_FOLDER_ID = "external-cal-1";
const OTHER_FOLDER_ID = "external-cal-2";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const MOVED_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";

const SKIP_TOKEN_PARAM = "$skiptoken";
const SECOND_PAGE_TOKEN = "page-2";

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

const isSecondPageRead = (url: URL): boolean =>
  url.searchParams.get(SKIP_TOKEN_PARAM) === SECOND_PAGE_TOKEN;

const buildNextLink = (url: URL): string => {
  const next = new URL(url.toString());
  next.searchParams.set(SKIP_TOKEN_PARAM, SECOND_PAGE_TOKEN);
  return next.toString();
};

const mailboxCalendars = [
  { id: DEFAULT_FOLDER_ID, isDefaultCalendar: true, name: "Calendar" },
  { id: DESTINATION_FOLDER_ID, isDefaultCalendar: false, name: "Keeper" },
  { id: OTHER_FOLDER_ID, isDefaultCalendar: false, name: "Personal" },
];

interface PagingMailboxOptions {
  events: MailboxEvent[];
  brokenSecondPageFolderId?: string;
}

const installPagingGraphMailbox = (options: PagingMailboxOptions): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ method, url: url.toString() });

    if (method !== "GET") {
      return Promise.resolve(Response.json(
        makeMailboxEvent("AAMkAGduplicate", "created-uid", readAddressedFolderId(url)),
      ));
    }

    if (isCalendarCollectionRead(url)) {
      return Promise.resolve(Response.json({ value: mailboxCalendars }));
    }

    const directId = readDirectEventId(url);
    if (directId) {
      const held = options.events.find((event) => event.id === directId);
      if (!held) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(held));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    if (uid === null) {
      const inFolder = options.events.filter((event) => event.folderId === folderId);
      return Promise.resolve(Response.json({ value: inFolder }));
    }

    if (!isSecondPageRead(url)) {
      return Promise.resolve(Response.json({
        "@odata.nextLink": buildNextLink(url),
        value: [],
      }));
    }

    if (options.brokenSecondPageFolderId === folderId) {
      return Promise.resolve(Response.json(
        { error: { code: "InternalServerError", message: "page unavailable" } },
        { status: 500 },
      ));
    }

    const matched = options.events.filter(
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

const secondPageReads = (requests: GraphRequest[]): GraphRequest[] =>
  requests.filter((request) => request.url.includes(`${SKIP_TOKEN_PARAM}=${SECOND_PAGE_TOKEN}`));

describe("Outlook proves a uid absent only after walking every page of the filtered listing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the nextLink and reports a mirror held on page two of the destination as present", async () => {
    const requests = installPagingGraphMailbox({
      events: [makeMailboxEvent(MOVED_ID, MIRROR_UID, DESTINATION_FOLDER_ID)],
    });

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]?.status).toBe("present");
    expect(report[0]?.event).toMatchObject({ summary: "Quarterly review" });
    expect(secondPageReads(requests).length).toBeGreaterThan(0);
  });

  it("reports a mirror held on page two of a sibling folder as elsewhere, not absent", async () => {
    installPagingGraphMailbox({
      events: [makeMailboxEvent(MOVED_ID, MIRROR_UID, OTHER_FOLDER_ID)],
    });

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report[0]?.status).toBe("elsewhere");
  });

  it("reports unknown when a page mid-walk cannot be read", async () => {
    installPagingGraphMailbox({
      brokenSecondPageFolderId: DESTINATION_FOLDER_ID,
      events: [makeMailboxEvent(MOVED_ID, MIRROR_UID, DESTINATION_FOLDER_ID)],
    });

    const report = await verifyTargets([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toEqual([{ identifier: MAPPED_ID, status: "unknown" }]);
  });

  it("creates nothing end to end when the mirror only appears on the second page", async () => {
    const requests = installPagingGraphMailbox({
      events: [makeMailboxEvent(MOVED_ID, MIRROR_UID, DESTINATION_FOLDER_ID)],
    });

    const outcome = await reconcileMissingMirror();

    expect(postedRequests(requests)).toEqual([]);
    expect(outcome.result.added).toBe(0);
  });
});

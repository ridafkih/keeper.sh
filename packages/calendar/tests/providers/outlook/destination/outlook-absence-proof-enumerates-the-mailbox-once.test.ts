import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const BIRTHDAYS_FOLDER_ID = "the-mailbox-birthdays-calendar";
const HOLIDAYS_FOLDER_ID = "the-mailbox-holidays-calendar";
const PERSONAL_FOLDER_ID = "the-recipients-personal-calendar";

const MAILBOX_FOLDER_IDS = [
  DEFAULT_FOLDER_ID,
  DESTINATION_FOLDER_ID,
  BIRTHDAYS_FOLDER_ID,
  HOLIDAYS_FOLDER_ID,
  PERSONAL_FOLDER_ID,
];

const SIBLING_FOLDER_COUNT = MAILBOX_FOLDER_IDS.length - 1;

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const START_WALL = "2026-09-01T15:00:00.0000000";
const END_WALL = "2026-09-01T16:00:00.0000000";

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
  end: { dateTime: END_WALL, timeZone: "UTC" },
  folderId,
  iCalUId,
  id,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: START_WALL, timeZone: "UTC" },
  subject: "Quarterly review",
});

const mappedIdFor = (index: number): string => `AAMkAGmirror-${index}`;
const uidFor = (index: number): string => `mirror-uid-${index}`;

interface VerificationTarget {
  deleteId: string;
  uid: string;
}

const makeTargets = (count: number): VerificationTarget[] =>
  Array.from({ length: count }, (_unused, index) => ({
    deleteId: mappedIdFor(index),
    uid: uidFor(index),
  }));

interface GraphRequest {
  kind: "enumeration" | "folder-listing" | "direct-read" | "other";
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

const classifyRequest = (url: URL, method: string): GraphRequest["kind"] => {
  if (method !== "GET") {
    return "other";
  }
  if (isCalendarCollectionRead(url)) {
    return "enumeration";
  }
  if (readDirectEventId(url)) {
    return "direct-read";
  }
  return "folder-listing";
};

interface Mailbox {
  events: MailboxEvent[];
  folderIds: string[];
  requests: GraphRequest[];
  enumerationStatus: number;
}

const installGraphMailbox = (options: {
  events?: MailboxEvent[];
  folderIds?: string[];
  enumerationStatus?: number;
}): Mailbox => {
  const mailbox: Mailbox = {
    enumerationStatus: options.enumerationStatus ?? 200,
    events: options.events ?? [],
    folderIds: options.folderIds ?? [...MAILBOX_FOLDER_IDS],
    requests: [],
  };

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? "GET";
      mailbox.requests.push({ kind: classifyRequest(url, method), method, url: url.toString() });

      if (method !== "GET") {
        return Promise.resolve(
          Response.json(
            makeMailboxEvent("AAMkAGcreated", "created-uid", readAddressedFolderId(url)),
          ),
        );
      }

      if (isCalendarCollectionRead(url)) {
        if (mailbox.enumerationStatus !== 200) {
          return Promise.resolve(new Response(null, { status: mailbox.enumerationStatus }));
        }
        return Promise.resolve(
          Response.json({ value: mailbox.folderIds.map((id) => ({ id })) }),
        );
      }

      const directId = readDirectEventId(url);
      if (directId) {
        const held = mailbox.events.find((event) => event.id === directId);
        if (!held) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        return Promise.resolve(Response.json(held));
      }

      const folderId = readAddressedFolderId(url);
      const uid = readFilteredUid(url);
      const matched = mailbox.events.filter(
        (event) => event.folderId === folderId && (uid === null || event.iCalUId === uid),
      );
      return Promise.resolve(Response.json({ value: matched }));
    }),
  );

  return mailbox;
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

type VerifyEventsExist = (targets: VerificationTarget[]) => Promise<EventPresence[]>;

const verifierOf = (provider: ReturnType<typeof createProvider>): VerifyEventsExist =>
  provider.verifyEventsExist as unknown as VerifyEventsExist;

const countOf = (mailbox: Mailbox, kind: GraphRequest["kind"]): number =>
  mailbox.requests.filter((request) => request.kind === kind).length;

const localEventFor = (index: number): MaterializedSyncableEvent => ({
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: START_TIME,
  summary: "Quarterly review",
});

const mappingFor = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: mappedIdFor(index),
  destinationEventUid: uidFor(index),
  endTime: END_TIME,
  eventStateId: `sync-event-${index}`,
  id: `mapping-${index}`,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(localEventFor(index)),
  syncEventId: `sync-event-${index}`,
});

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

describe("Outlook proves absence without re-enumerating the mailbox once per target", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads /me/calendars exactly once for a verification call that settles ten targets", async () => {
    const mailbox = installGraphMailbox({});

    const report = await verifierOf(createProvider())(makeTargets(10));

    expect(report).toHaveLength(10);
    expect(countOf(mailbox, "enumeration")).toBe(1);
  });

  it("spends only the per-target folder reads plus one enumeration for the whole call", async () => {
    const mailbox = installGraphMailbox({});
    const targetCount = 10;

    await verifierOf(createProvider())(makeTargets(targetCount));

    const listingsPerTarget = 1 + SIBLING_FOLDER_COUNT;
    const requestsPerTarget = 1 + listingsPerTarget;
    expect(countOf(mailbox, "direct-read")).toBe(targetCount);
    expect(countOf(mailbox, "folder-listing")).toBe(targetCount * listingsPerTarget);
    expect(mailbox.requests).toHaveLength(targetCount * requestsPerTarget + 1);
  });

  it("still calls every target of an emptied mailbox absent", async () => {
    installGraphMailbox({});

    const report = await verifierOf(createProvider())(makeTargets(10));

    expect(report.map((presence) => presence.status)).toEqual(Array.from({ length: 10 }, () => "absent"));
  });

  it("calls every target unknown when the mailbox enumeration cannot be read", async () => {
    installGraphMailbox({ enumerationStatus: 500 });

    const report = await verifierOf(createProvider())(makeTargets(10));

    expect(report).toHaveLength(10);
    for (const presence of report) {
      expect(presence.status).toBe("unknown");
    }
  });

  it("sees a folder created between two verification calls on the same provider", async () => {
    const mailbox = installGraphMailbox({});
    const provider = createProvider();
    const verify = verifierOf(provider);

    const before = await verify(makeTargets(1));
    expect(before[0]?.status).toBe("absent");

    const NEW_FOLDER_ID = "a-folder-the-recipient-just-made";
    mailbox.folderIds = [...mailbox.folderIds, NEW_FOLDER_ID];
    mailbox.events = [makeMailboxEvent("AAMkAGmoved-here", uidFor(0), NEW_FOLDER_ID)];

    const after = await verify(makeTargets(1));

    expect(after[0]?.status).not.toBe("absent");
  });

  it("does not re-enumerate per target when the engine drives the restore path", async () => {
    const mailbox = installGraphMailbox({});
    const targetCount = 4;
    const locals = Array.from({ length: targetCount }, (_unused, index) => localEventFor(index));
    const mappings = Array.from({ length: targetCount }, (_unused, index) => mappingFor(index));

    const { operations } = computeSyncOperations(locals, mappings, [], RECONCILIATION_SCOPE);
    expect(operations).toHaveLength(targetCount);

    const provider = createProvider();
    let verificationCalls = 0;
    const verify = verifierOf(provider);
    const countingProvider = {
      ...provider,
      verifyEventsExist: (targets: VerificationTarget[]) => {
        verificationCalls += 1;
        return verify(targets);
      },
    };

    await executeRemoteOperations(
      operations,
      mappings,
      DESTINATION_CALENDAR_ID,
      countingProvider as unknown as ReturnType<typeof createProvider>,
    );

    expect(verificationCalls).toBeGreaterThan(0);
    expect(countOf(mailbox, "enumeration")).toBeLessThanOrEqual(verificationCalls);
    expect(countOf(mailbox, "enumeration")).toBeLessThan(targetCount);
  });
});

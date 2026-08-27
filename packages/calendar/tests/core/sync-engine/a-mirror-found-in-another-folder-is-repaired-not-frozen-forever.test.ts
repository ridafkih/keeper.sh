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

const TARGETED_READ_SCOPE = {
  authoritativeMappingIds: new Set([MAPPING_ID]),
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const readRepairsFor = (updates: PendingUpdate[]): PendingUpdate[] =>
  updates.filter((update) => update.id === MAPPING_ID && update.deleteIdentifier === REKEYED_ID);

const namesTheStuckMapping = (errors: { error: string }[]): boolean =>
  errors.some((entry) => entry.error.includes(MAPPING_ID));

interface CycleOutcome {
  checkpointedUpdates: PendingUpdate[];
  countersRaised: boolean;
  errors: { error: string }[];
  patches: GraphRequest[];
  repairs: PendingUpdate[];
  requests: GraphRequest[];
  updates: PendingUpdate[];
}

const describeDisposition = (cycle: CycleOutcome): string => {
  const repairedInPlace = cycle.repairs.length > 0
    && cycle.patches.some((patch) =>
      patch.url.includes(REKEYED_ID) && readPatchedSubject(patch.body) === EDITED_SUBJECT
    );
  if (repairedInPlace) {
    return "repaired the mapping and delivered the edit";
  }
  if (namesTheStuckMapping(cycle.errors) && cycle.countersRaised) {
    return "reported the unresolved mapping";
  }
  return "silently idle: nothing written, nothing said";
};

const runCycle = async (
  mappings: EventMapping[],
  requests: GraphRequest[],
): Promise<CycleOutcome> => {
  const before = requests.length;
  const checkpointed: PendingChanges[] = [];
  const { operations } = computeSyncOperations(
    [localEvent],
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

  const madeRequests = requests.slice(before);
  const checkpointedUpdates = checkpointed.flatMap((changes) => changes.updates ?? []);
  const updates = outcome.changes.updates ?? [];
  return {
    checkpointedUpdates,
    countersRaised: outcome.verificationUnsettled > 0
      || outcome.result.addFailed > 0
      || outcome.result.removeFailed > 0,
    errors: outcome.errors,
    patches: requestsOfMethod(madeRequests, "PATCH"),
    repairs: readRepairsFor([...updates, ...checkpointedUpdates]),
    requests: madeRequests,
    updates,
  };
};

const applyRepairs = (existing: EventMapping, updates: PendingUpdate[]): EventMapping => {
  const repair = updates.find((update) => update.id === existing.id);
  if (!repair) {
    return existing;
  }
  return {
    ...existing,
    deleteIdentifier: repair.deleteIdentifier ?? existing.deleteIdentifier,
    destinationEventUid: repair.destinationEventUid ?? existing.destinationEventUid,
    syncEventHash: repair.syncEventHash ?? existing.syncEventHash,
  };
};

describe("a mirror found in another folder is repaired, not frozen forever", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the located item id and uid on the elsewhere verdict", async () => {
    installGraphMailbox([makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID)]);

    const provider = createProvider();
    const { verifyEventsExist } = provider;
    expect(verifyEventsExist).toBeDefined();
    if (!verifyEventsExist) {
      throw new TypeError("Expected the provider to expose verifyEventsExist");
    }

    const report = await verifyEventsExist([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ identifier: MAPPED_ID, status: "elsewhere" });
    expect(report[0]?.event).toMatchObject({ deleteId: REKEYED_ID, uid: MIRROR_UID });
  });

  it("never duplicates or destroys the mirror it located in another folder", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID),
    ]);

    const { operations } = computeSyncOperations([localEvent], [mapping], [], TARGETED_READ_SCOPE);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ deleteId: MAPPED_ID, remoteMissing: true, type: "replace" });

    const cycle = await runCycle([mapping], requests);

    expect(requestsOfMethod(cycle.requests, "POST")).toEqual([]);
    expect(requestsOfMethod(cycle.requests, "DELETE")).toEqual([]);
  });

  it("does not end the run having written nothing and said nothing", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID),
    ]);

    const cycle = await runCycle([mapping], requests);

    expect(describeDisposition(cycle)).not.toBe("silently idle: nothing written, nothing said");
  });

  it("does not recompute the same dead no-op plan on the very next cycle", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(REKEYED_ID, MIRROR_UID, DEFAULT_FOLDER_ID),
    ]);

    const first = await runCycle([mapping], requests);
    const persisted = applyRepairs(mapping, [...first.updates, ...first.checkpointedUpdates]);
    const second = await runCycle([persisted], requests);

    expect(requestsOfMethod(second.requests, "POST")).toEqual([]);
    expect(requestsOfMethod(second.requests, "DELETE")).toEqual([]);
    expect(describeDisposition(second)).not.toBe("silently idle: nothing written, nothing said");
  });
});

import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  DeleteResult,
  EventPresence,
  EventPresenceStatus,
  MaterializedSyncableEvent,
  PushResult,
  SyncOperation,
} from "../../../src/core/types";

const UNRESOLVABLE_TIME_ZONE = "Mideast/Riyadh87";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPING_ID = "mapping-1";
const MIRROR_ITEM_ID = "AAMkAGmirror-1";
const MIRROR_UID = "mirror-uid-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  startTimeZone: UNRESOLVABLE_TIME_ZONE,
  summary: "Quarterly review — moved to Thursday",
};

interface GraphRequest {
  body: string | null;
  method: string;
  path: string;
}

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

const mirrorInTheMailbox = (): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId: DESTINATION_FOLDER_ID,
  iCalUId: MIRROR_UID,
  id: MIRROR_ITEM_ID,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: "Quarterly review",
});

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

interface SyntheticMailbox {
  heldIds: () => string[];
  requests: GraphRequest[];
}

const installGraphMailbox = (): SyntheticMailbox => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [mirrorInTheMailbox()];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ body: readRequestBody(init), method, path: url.pathname });

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
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const created: MailboxEvent = {
        ...mirrorInTheMailbox(),
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
    const matched = held.filter((event) => event.folderId === folderId && event.iCalUId === uid);
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return { heldIds: () => held.map((event) => event.id), requests };
};

const createOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: DESTINATION_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const outlookMapping = (consecutiveUpdateFailures: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  consecutiveUpdateFailures,
  deleteIdentifier: MIRROR_ITEM_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const carryMappingForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
  checkpointed: PendingChanges[],
): EventMapping => {
  const written = [
    ...(outcome.changes.updates ?? []),
    ...checkpointed.flatMap((changes) => changes.updates ?? []),
  ].find((update) => update.id === mapping.id);
  if (!written) {
    return mapping;
  }
  return { ...mapping, ...written, id: mapping.id } as EventMapping;
};

const CYCLES = 3;

interface OutlookRun {
  errors: { error: string }[];
  heldIds: string[];
  requests: GraphRequest[];
}

const runThreeOutlookCycles = async (): Promise<OutlookRun> => {
  const mailbox = installGraphMailbox();
  const errors: { error: string }[] = [];
  let mapping = outlookMapping(0);

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const checkpointed: PendingChanges[] = [];
    const outcome = await executeRemoteOperations(
      [replacementFor(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createOutlookProvider(),
      globalThis.undefined,
      globalThis.undefined,
      (changes: PendingChanges) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );
    errors.push(...outcome.errors);
    mapping = carryMappingForward(mapping, outcome, checkpointed);
  }

  return { errors, heldIds: mailbox.heldIds(), requests: mailbox.requests };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a failure that never left the process may not license a delete", () => {
  it("refuses the same event on the create verb as on the update verb", () => {
    expect(() => serializeOutlookEvent(editedEvent)).toThrow(RangeError);
    expect(() => serializeOutlookEvent(editedEvent)).toThrow(/Unsupported calendar timezone/u);
  });

  it("issues no DELETE across three cycles and leaves the mailbox holding the event", async () => {
    const run = await runThreeOutlookCycles();

    expect(run.requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(run.heldIds).toEqual([MIRROR_ITEM_ID]);
  });

  it("names the frozen mapping instead of destroying it", async () => {
    const run = await runThreeOutlookCycles();

    expect(run.errors.some((entry) => entry.error.includes(MAPPING_ID))).toBe(true);
  });

  it("asks the destination about the mirror instead of routing at the delete-first escape", async () => {
    const run = await runThreeOutlookCycles();

    const reads = run.requests.filter((request) => request.method === "GET");
    expect(reads.some((request) => request.path.includes(MIRROR_ITEM_ID))).toBe(true);
  });
});

const UNIT_CALENDAR_ID = "dest-cal-2";
const UNIT_MAPPING_ID = "map-unit-1";
const LIVE_ITEM_ID = "live-item-id";
const LIVE_UID = "live-uid";

const unitEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-2",
  calendarName: "Source",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-2",
  sourceEventUid: "source-uid-2",
  startTime: START_TIME,
  summary: "Standup, moved",
};

const unitMapping: EventMapping = {
  calendarId: UNIT_CALENDAR_ID,
  consecutiveUpdateFailures: 2,
  deleteIdentifier: LIVE_ITEM_ID,
  destinationEventUid: LIVE_UID,
  endTime: END_TIME,
  eventStateId: unitEvent.id,
  id: UNIT_MAPPING_ID,
  sourceCalendarId: "source-cal-2",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: unitEvent.id,
};

const SERIALIZATION_REFUSAL: PushResult = {
  error: "cannot serialize this event",
  errorType: "EventSerializationError",
  success: false,
};

const REMOVED_THE_OBJECT: DeleteResult = { removedObject: true, success: true };

const readPresence = (calendar: Set<string>, deleteId: string): EventPresenceStatus => {
  if (calendar.has(deleteId)) {
    return "present";
  }
  return "absent";
};

interface RecordingProvider {
  calls: string[];
  calendar: Set<string>;
  provider: CalendarSyncProvider;
}

const createRefusingProvider = (): RecordingProvider => {
  const calls: string[] = [];
  const calendar = new Set<string>([LIVE_ITEM_ID]);

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      calls.push(...eventIds.map((eventId) => `delete:${eventId}`));
      return Promise.resolve(eventIds.map((eventId): DeleteResult => {
        calendar.delete(eventId);
        return REMOVED_THE_OBJECT;
      }));
    },
    listRemoteEvents: () => Promise.resolve([]),
    prepareEvent: () => {
      calls.push("prepare");
      throw new RangeError("Unsupported calendar timezone: Mideast/Riyadh87");
    },
    pushEvents: (events) => {
      calls.push("push");
      return Promise.resolve(events.map(() => SERIALIZATION_REFUSAL));
    },
    updateEvents: (updates) => {
      calls.push(...updates.map((update) => `update:${update.deleteId}`));
      return Promise.resolve(updates.map(() => SERIALIZATION_REFUSAL));
    },
    verifyEventsExist: (targets) => {
      calls.push(...targets.map((target) => `verify:${target.deleteId}`));
      return Promise.resolve(targets.map((target): EventPresence => ({
        identifier: target.deleteId,
        status: readPresence(calendar, target.deleteId),
      })));
    },
  };

  return { calendar, calls, provider };
};

const replaceTheUnitMirror = async (provider: CalendarSyncProvider) =>
  await executeRemoteOperations(
    [{
      deleteId: LIVE_ITEM_ID,
      event: unitEvent,
      staleMappingId: UNIT_MAPPING_ID,
      type: "replace",
      uid: LIVE_UID,
    }],
    [unitMapping],
    UNIT_CALENDAR_ID,
    provider,
  );

describe("a push refusal whose recreate cannot be built never routes to delete-then-add", () => {
  it("never calls deleteEvents on the promotion cycle", async () => {
    const { calendar, calls, provider } = createRefusingProvider();

    const outcome = await replaceTheUnitMirror(provider);

    expect(calls.filter((call) => call.startsWith("delete:"))).toEqual([]);
    expect(calendar.size).toBe(1);
    expect(outcome.changes.deletes).not.toContain(UNIT_MAPPING_ID);
    expect(outcome.result.removed).toBe(0);
  });

  it("asks the destination about the mirror rather than taking the delete-first escape", async () => {
    const { calls, provider } = createRefusingProvider();

    await replaceTheUnitMirror(provider);

    expect(calls).toContain(`verify:${LIVE_ITEM_ID}`);
  });

  it("names the frozen mapping in the run's errors", async () => {
    const { provider } = createRefusingProvider();

    const outcome = await replaceTheUnitMirror(provider);

    expect(outcome.errors.some((entry) => entry.error.includes(UNIT_MAPPING_ID))).toBe(true);
  });
});

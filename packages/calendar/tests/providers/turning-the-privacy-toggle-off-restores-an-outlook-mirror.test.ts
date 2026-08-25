import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingUpdate } from "../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, SyncOperation } from "../../src/core/types";

type StoredEvent = Record<string, unknown>;

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const OUTLOOK_EVENT_ID = "AAMkAGViNDU3OWQzLWRlLTQ0";
const OUTLOOK_ICAL_UID = "outlook-ical-uid-1@keeper.sh";
const PRIVATE_SENSITIVITY = "private";
const NORMAL_SENSITIVITY = "normal";
const PREVIOUS_SUMMARY = "Meeting";
const CURRENT_SUMMARY = "Team sync";

const SYNC_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const RECONCILIATION_SCOPE = {
  authoritativeWindow: SYNC_WINDOW,
  requestedWindow: SYNC_WINDOW,
};

const nonPrivateEvent: MaterializedSyncableEvent = {
  availability: "busy",
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: CURRENT_SUMMARY,
};

const whileStillPrivateHash = createSyncEventContentHash({
  ...nonPrivateEvent,
  summary: PREVIOUS_SUMMARY,
});

const makeMapping = (): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: OUTLOOK_EVENT_ID,
  destinationEventUid: OUTLOOK_ICAL_UID,
  endTime: nonPrivateEvent.endTime,
  eventStateId: nonPrivateEvent.id,
  id: "map-1",
  sourceCalendarId: nonPrivateEvent.calendarId,
  startTime: nonPrivateEvent.startTime,
  syncEventHash: whileStillPrivateHash,
  syncEventId: nonPrivateEvent.id,
});

const applyMappingUpdate = (mapping: EventMapping, update: PendingUpdate): EventMapping => ({
  ...mapping,
  deleteIdentifier: update.deleteIdentifier,
  destinationEventUid: update.destinationEventUid ?? mapping.destinationEventUid,
  endTime: update.endTime,
  startTime: update.startTime,
  syncEventHash: update.syncEventHash,
  syncEventId: update.syncEventId,
});

const overTheWire = (body: unknown): Record<string, unknown> => {
  const wireText = JSON.stringify(body ?? {});
  const encoded: unknown = JSON.parse(wireText);
  if (typeof encoded !== "object" || encoded === null) {
    return {};
  }
  return { ...encoded };
};

const writeSentKeys = (base: StoredEvent, sent: Record<string, unknown>): StoredEvent => {
  const written: StoredEvent = { ...base };
  for (const [key, value] of Object.entries(sent)) {
    if (value === null) {
      continue;
    }
    written[key] = value;
  }
  return written;
};

const mergeIntoStored = (stored: StoredEvent, sent: Record<string, unknown>): StoredEvent => {
  const kept: StoredEvent = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key in sent) {
      continue;
    }
    kept[key] = value;
  }
  return writeSentKeys(kept, sent);
};

const replaceStored = (immutable: StoredEvent, sent: Record<string, unknown>): StoredEvent =>
  writeSentKeys(immutable, sent);

const createPrivateMirrorStore = () => {
  const writes: Record<string, unknown>[] = [];
  let stored: StoredEvent = {
    categories: ["keeper.sh"],
    end: { dateTime: "2026-03-15T10:00:00.0000000", timeZone: "UTC" },
    iCalUId: OUTLOOK_ICAL_UID,
    id: OUTLOOK_EVENT_ID,
    isAllDay: false,
    sensitivity: PRIVATE_SENSITIVITY,
    showAs: "busy",
    start: { dateTime: "2026-03-15T09:00:00.0000000", timeZone: "UTC" },
    subject: PREVIOUS_SUMMARY,
  };

  const nextState = (method: string, sent: Record<string, unknown>): StoredEvent => {
    if (method === "PATCH") {
      return mergeIntoStored(stored, sent);
    }
    return replaceStored({ iCalUId: OUTLOOK_ICAL_UID, id: OUTLOOK_EVENT_ID }, sent);
  };

  const handle = (init: RequestInit): Response => {
    const method = String(init.method);
    if (method === "GET") {
      return Response.json({ value: [{ ...stored }] });
    }
    const sent = overTheWire(JSON.parse(String(init.body)));
    writes.push(sent);
    stored = nextState(method, sent);
    return Response.json({ ...stored });
  };

  return { handle, read: () => stored, writes };
};

const createOutlookProvider = (): CalendarSyncProvider => createOutlookSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: DESTINATION_CALENDAR_ID,
  externalCalendarId: "external-cal-1",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const reconcile = async (
  provider: CalendarSyncProvider,
  mapping: EventMapping,
): Promise<SyncOperation[]> => {
  const remoteEvents = await provider.listRemoteEvents(SYNC_WINDOW);
  const { operations } = computeSyncOperations(
    [nonPrivateEvent],
    [mapping],
    remoteEvents,
    RECONCILIATION_SCOPE,
  );
  return operations;
};

describe("turning the privacy toggle off restores an outlook mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites an already private mirror as non-private and then settles", async () => {
    const store = createPrivateMirrorStore();
    vi.stubGlobal("fetch", vi.fn((_input: string | URL, init: RequestInit) =>
      Promise.resolve(store.handle(init))));

    const provider = createOutlookProvider();
    const mapping = makeMapping();
    const operations = await reconcile(provider, mapping);
    expect(operations.map((operation) => operation.type)).toEqual(["replace"]);

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );

    expect(outcome.errors).toEqual([]);
    const update = outcome.changes.updates?.[0];
    if (!update) {
      throw new Error("Expected the in-place update to rewrite the mapping");
    }

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ sensitivity: NORMAL_SENSITIVITY });
    expect(store.read()["sensitivity"]).toBe(NORMAL_SENSITIVITY);

    const settled = applyMappingUpdate(mapping, update);
    expect(await reconcile(provider, settled)).toEqual([]);
    expect(store.writes).toHaveLength(1);
  });
});

import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../../src/core/sync-engine/index";
import type {
  CalendarSyncProvider,
  PendingChanges,
} from "../../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../../src/index";
import { createEditableEventContentHash } from "../../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import { normalizeGoogleEvent } from "../../../../src/providers/google/destination/normalize-event";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";
import { GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH } from "../../../../src/providers/google/shared/api";
import { parseEventTime } from "../../../../src/providers/google/shared/date-time";

const WIDE_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const WIDE_SCOPE = { authoritativeWindow: WIDE_WINDOW, requestedWindow: WIDE_WINDOW };

const IDLE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const buildEvent = (description: string): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  description,
  endTime: new Date("2027-06-01T17:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-06-01T16:00:00.000Z"),
  startTimeZone: "UTC",
  summary: "Quarterly planning",
} as MaterializedSyncableEvent);

const storeAsGoogleDoes = (sent: GoogleEvent): GoogleEvent => ({
  ...sent,
  description: sent.description?.slice(0, GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH),
});

const toRemoteEvent = (id: string, stored: GoogleEvent): RemoteEvent => {
  const startTime = parseEventTime(stored.start);
  const endTime = parseEventTime(stored.end);
  if (!startTime || !endTime) {
    throw new Error("stored event is missing its times");
  }
  return {
    deleteId: id,
    editableAvailability: "busy",
    editableContentHash: createEditableEventContentHash({
      description: stored.description,
      endTime,
      isAllDay: Boolean(stored.start?.date),
      location: stored.location,
      startTime,
      summary: stored.summary ?? "",
    }),
    endTime,
    isKeeperEvent: true,
    startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: stored.iCalUID ?? id,
  } as RemoteEvent;
};

const createGoogleHarness = (event: MaterializedSyncableEvent) => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, GoogleEvent>();
  const deletes: string[] = [];
  let nextRemoteId = 1;
  let writes = 0;

  const listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(
    [...resources.entries()].map(([id, stored]) => toRemoteEvent(id, stored)),
  );

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      for (const id of eventIds) {
        deletes.push(id);
        resources.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((pushedEvent) => {
      const uid = generateDeterministicEventUid(pushedEvent.id);
      const serialized = serializeGoogleEvent(pushedEvent, uid);
      if (!serialized) {
        return { error: "Event cannot be serialized for Google", success: false as const };
      }
      const googleEventId = `google-${nextRemoteId++}`;
      resources.set(googleEventId, storeAsGoogleDoes(serialized));
      writes += 1;
      return { deleteId: googleEventId, remoteId: uid, success: true as const };
    })),
  };

  const flush = (changes: PendingChanges): Promise<void> => {
    for (const deleted of changes.deletes) {
      const index = mappings.findIndex((mapping) => mapping.id === deleted);
      if (index !== -1) {
        mappings.splice(index, 1);
      }
    }
    for (const insert of changes.inserts) {
      mappings.push({
        calendarId: insert.calendarId,
        deleteIdentifier: insert.deleteIdentifier,
        destinationEventUid: insert.destinationEventUid,
        endTime: insert.endTime,
        eventStateId: insert.eventStateId,
        id: `mapping-${writes}-${insert.syncEventId}`,
        sourceCalendarId: insert.sourceCalendarId,
        startTime: insert.startTime,
        syncEventHash: insert.syncEventHash,
        syncEventId: insert.syncEventId,
      } as EventMapping);
    }
    return Promise.resolve();
  };

  const runSync = async () => {
    const result = await syncCalendar({
      calendarId: "destination-calendar",
      flush,
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: [event],
        remoteEvents: await listRemoteEvents(),
      }),
      reconciliationScope: WIDE_SCOPE,
      userId: "user-1",
    });
    return {
      added: result.added,
      addFailed: result.addFailed,
      removed: result.removed,
      removeFailed: result.removeFailed,
    };
  };

  const editStoredDescription = (edit: (description: string) => string): void => {
    for (const [id, stored] of resources) {
      resources.set(id, { ...stored, description: edit(stored.description ?? "") });
    }
  };

  const storedDescriptions = (): string[] =>
    [...resources.values()].map((stored) => stored.description ?? "");

  return {
    deletes,
    editStoredDescription,
    mappings,
    runSync,
    storedDescriptions,
    writes: () => writes,
  };
};

const repeatLine = (line: string, separator: string, length: number): string => {
  const lines: string[] = [];
  let total = 0;
  for (let index = 0; total < length; index++) {
    const next = `${line} ${index}`;
    lines.push(next);
    total += next.length + separator.length;
  }
  return lines.join(separator);
};

describe("google destination with a description longer than Google stores", () => {
  const cases = [
    { description: "x".repeat(GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH * 3), name: "plain text" },
    {
      description: repeatLine("Join the meeting from your phone", "\r\n", 9001),
      name: "CRLF text from an Outlook body",
    },
    {
      description: `${"a".repeat(GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH - 1)}\u{1F4C5}${"b".repeat(400)}`,
      name: "text with a surrogate pair across the limit",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors ${testCase.name} once and stops`, async () => {
      const harness = createGoogleHarness(buildEvent(testCase.description));

      const first = await harness.runSync();
      const rest = [await harness.runSync(), await harness.runSync()];

      expect(first).toMatchObject({ added: 1, addFailed: 0 });
      expect(rest).toEqual([IDLE, IDLE]);
      expect(harness.writes()).toBe(1);
      expect(harness.deletes).toEqual([]);
      expect(harness.mappings).toHaveLength(1);
      const [stored] = harness.storedDescriptions();
      expect(stored?.length).toBeLessThanOrEqual(GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH);
      expect(testCase.description.startsWith(stored ?? "")).toBe(true);
    });
  }

  it("still replaces a long mirror whose description was edited in Google", async () => {
    const harness = createGoogleHarness(buildEvent("x".repeat(GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH * 2)));

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    expect(await harness.runSync()).toEqual(IDLE);

    harness.editStoredDescription((description) => `edited ${description.slice(7)}`);

    expect(await harness.runSync()).toMatchObject({ added: 1, removed: 1 });
    expect(await harness.runSync()).toEqual(IDLE);
    expect(harness.writes()).toBe(2);
    expect(harness.storedDescriptions()[0]?.startsWith("edited")).toBe(false);
  });

  it("leaves a description within the limit as it was written", async () => {
    const description = "y".repeat(GOOGLE_EVENT_DESCRIPTION_MAX_LENGTH);
    const harness = createGoogleHarness(buildEvent(description));

    await harness.runSync();

    expect(harness.storedDescriptions()).toEqual([description]);
  });
});

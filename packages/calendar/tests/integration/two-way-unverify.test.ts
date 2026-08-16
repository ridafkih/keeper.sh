import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../src/index";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  PendingChanges,
  RemoteEvent,
} from "../../src/index";
import { createEditableEventContentHash } from "../../src/core/events/content-hash";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const USER_ID = "user-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PASS_START = new Date("2027-05-01T09:00:00.000Z");

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface SourceRow {
  description: string;
  endTime: Date;
  id: string;
  location: string;
  sourceEventUid: string;
  startTime: Date;
  title: string;
}

interface RemoteRecord {
  description?: string;
  endTime: Date;
  isAllDay: boolean;
  location?: string;
  startTime: Date;
  summary: string;
}

const requireValue = <TValue>(value?: TValue | null): TValue => {
  if (!value) {
    throw new Error("Expected an unverify harness value to exist");
  }
  return value;
};

const createHarness = () => {
  const log: string[] = [];
  const flushes: PendingChanges[] = [];
  const applierCalls: Record<string, unknown>[][] = [];
  const wideEvents: Record<string, unknown>[] = [];
  const rows = new Map<string, SourceRow>();
  const remote = new Map<string, RemoteRecord>();
  const mappings = new Map<string, EventMapping>();
  const sourceWrites: Record<string, unknown>[] = [];
  let nextRemoteId = 1;
  let nextMappingId = 1;
  let failFlush = false;

  const syncableEvents = (): MaterializedSyncableEvent[] =>
    [...rows.values()].map((row) => ({
      availability: "busy",
      calendarId: SOURCE_CALENDAR_ID,
      calendarName: "Personal",
      calendarUrl: null,
      description: row.description,
      endTime: row.endTime,
      eventStateId: row.id,
      id: row.id,
      isAllDay: false,
      location: row.location,
      sourceEventUid: row.sourceEventUid,
      startTime: row.startTime,
      summary: row.title,
    }));

  const provider = {
    deleteEvents: (eventIds: string[]) => {
      log.push("remote:delete");
      for (const id of eventIds) {
        remote.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () =>
      Promise.resolve({
        items: [...remote.entries()].map(([uid, record]) => ({
          deleteId: uid,
          editableAvailability: "busy",
          editableContentHash: createEditableEventContentHash(record),
          editableFields: {
            isAllDay: record.isAllDay,
            summary: record.summary,
            ...(record.description && { description: record.description }),
            ...(record.location && { location: record.location }),
          },
          endTime: record.endTime,
          isKeeperEvent: true,
          startTime: record.startTime,
          supportedAvailabilities: ["busy", "free"],
          uid,
        } as RemoteEvent)),
        rawItemCount: remote.size,
      }),
    pushEvents: (events: MaterializedSyncableEvent[]) => {
      log.push("remote:push");
      return Promise.resolve(events.map((event) => {
        const remoteId = `remote-${nextRemoteId++}`;
        remote.set(remoteId, {
          endTime: event.endTime,
          isAllDay: event.isAllDay ?? false,
          startTime: event.startTime,
          summary: event.summary,
          ...(event.description && { description: event.description }),
          ...(event.location && { location: event.location }),
        });
        return { deleteId: remoteId, remoteId, success: true };
      }));
    },
  };

  const flush = (changes: PendingChanges): Promise<void> => {
    flushes.push(changes);
    const clearsWitness = (changes.updates ?? []).some(
      (update) => Object.hasOwn(update, "destinationContentHash")
        && update.destinationContentHash === null,
    );
    if (clearsWitness) {
      log.push("flush:unverify");
    } else {
      log.push("flush");
    }
    if (failFlush && !clearsWitness) {
      failFlush = false;
      return Promise.reject(new Error("injected flush failure"));
    }
    for (const id of changes.deletes) {
      mappings.delete(id);
    }
    for (const insert of changes.inserts) {
      const id = `mapping-${nextMappingId++}`;
      mappings.set(id, { ...insert, id } as EventMapping);
    }
    for (const update of changes.updates ?? []) {
      const mapping = mappings.get(update.id);
      if (mapping) {
        mappings.set(update.id, { ...mapping, ...update });
      }
    }
    return Promise.resolve();
  };

  const applyInboundChanges = (input: { classifications: Record<string, unknown>[] }) => {
    applierCalls.push(input.classifications.map((entry) => ({ ...entry })));
    let applied = 0;
    for (const classification of input.classifications) {
      if (classification["type"] === "write-back") {
        sourceWrites.push(classification);
        applied += 1;
      }
    }
    return Promise.resolve({ applied, failed: 0 });
  };

  const runPass = async (now: Date = PASS_START): Promise<Record<string, unknown>> => {
    await syncCalendar({
      applyInboundChanges,
      calendarId: DESTINATION_CALENDAR_ID,
      flush,
      isCurrent: () => Promise.resolve(true),
      now: () => now,
      onSyncEvent: (event: Record<string, unknown>) => wideEvents.push(event),
      provider,
      readState: async () => {
        const listing = await provider.listRemoteEvents();
        return {
          existingMappings: [...mappings.values()],
          localEvents: syncableEvents(),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
          destinationCalendarId: DESTINATION_CALENDAR_ID,
          excludeEventDescription: false,
          excludeEventLocation: false,
          excludeEventName: false,
          sourceCalendarId: SOURCE_CALENDAR_ID,
          writeBackMode: "edits",
        }]]),
      },
      userId: USER_ID,
    } as never);
    return requireValue(wideEvents.at(-1));
  };

  return {
    applierCalls,
    armFlushFailure: () => {
      failFlush = true;
    },
    editMirror: (patch: Partial<RemoteRecord>) => {
      const [uid, record] = requireValue([...remote.entries()][0]);
      remote.set(uid, { ...record, ...patch });
    },
    editSource: (patch: Partial<SourceRow>) => {
      const [id, row] = requireValue([...rows.entries()][0]);
      rows.set(id, { ...row, ...patch });
    },
    flushes,
    log,
    mappings,
    runPass,
    seed: () => {
      rows.set("event-state-1", {
        description: "Bring the notes",
        endTime: END_TIME,
        id: "event-state-1",
        location: "Room 4",
        sourceEventUid: "source-event-uid-1",
        startTime: START_TIME,
        title: "Quarterly review",
      });
    },
    sourceWrites,
    wideEvents,
  };
};

const onlyMapping = (
  mappings: Map<string, EventMapping>,
): Record<string, unknown> =>
  requireValue([...mappings.values()][0]) as unknown as Record<string, unknown>;

describe("two-way sync: a write unverifies the witness before it happens", () => {
  it("clears the witness in a flush issued ahead of the remote operations", async () => {
    const harness = createHarness();
    harness.seed();
    await harness.runPass();
    await harness.runPass();
    harness.log.length = 0;

    harness.editSource({ title: "Quarterly review with Dana" });
    await harness.runPass();

    const unverifyIndex = harness.log.indexOf("flush:unverify");
    const pushIndex = harness.log.indexOf("remote:push");

    expect(unverifyIndex).toBeGreaterThanOrEqual(0);
    expect(unverifyIndex).toBeLessThan(pushIndex);
  });

  it("adopts rather than writes back when a replace crashed before its flush", async () => {
    const harness = createHarness();
    harness.seed();
    await harness.runPass();
    await harness.runPass();

    const witnessed = onlyMapping(harness.mappings);
    expect(witnessed["destinationContentHash"]).toBeTypeOf("string");

    harness.editSource({ title: "Quarterly review with Dana" });
    harness.armFlushFailure();
    await expect(harness.runPass()).rejects.toThrow();

    const survivor = onlyMapping(harness.mappings);

    expect(survivor["destinationContentHash"]).toBeNull();

    harness.sourceWrites.length = 0;
    await harness.runPass();

    expect(harness.sourceWrites).toEqual([]);
  });
});

describe("two-way sync: the adopt window is visible rather than silent", () => {
  it("adopts an edit made before the first observation and counts the divergence", async () => {
    const harness = createHarness();
    harness.seed();
    await harness.runPass();

    harness.editMirror({ summary: "Edited inside the adopt window" });
    const wideEvent = await harness.runPass();

    expect(harness.sourceWrites).toEqual([]);
    expect(wideEvent["two_way.adopt_window_divergence_count"]).toBe(1);
  });

  it("does not count a divergence when the copy came back exactly as pushed", async () => {
    const harness = createHarness();
    harness.seed();
    await harness.runPass();

    const wideEvent = await harness.runPass();

    expect(harness.sourceWrites).toEqual([]);
    expect(wideEvent["two_way.adopt_window_divergence_count"]).toBeUndefined();
  });
});

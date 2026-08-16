import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../src/index";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  PendingChanges,
  RemoteEvent,
} from "../../src/index";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../src/core/events/content-hash";
import { resolveWriteBackPolicyState } from "../../src/core/sync/write-back-policy";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const USER_ID = "user-1";
const MINUTE_MS = 60_000;
const PASS_START = new Date("2027-05-01T09:00:00.000Z");
const MISSING_FIRST_OBSERVED_AT = new Date(PASS_START.getTime() - (20 * MINUTE_MS));
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const LIVENESS_PASS_COUNT = 3;
const TRUNCATED_RAW_ITEM_COUNT = 3;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const requireValue = <TValue>(value?: TValue | null): TValue => {
  if (!value) {
    throw new Error("Expected liveness harness value to exist");
  }
  return value;
};

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent> & { id: string },
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  endTime: END_TIME,
  eventStateId: overrides.id,
  isAllDay: false,
  sourceEventUid: `uid-${overrides.id}`,
  startTime: START_TIME,
  summary: "Quarterly review",
  ...overrides,
} as MaterializedSyncableEvent);

const createRemoteEvent = (
  uid: string,
  event: { description?: string; endTime: Date; startTime: Date; summary: string },
): RemoteEvent => ({
  deleteId: uid,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash({
    isAllDay: false,
    summary: event.summary,
    ...(event.description && { description: event.description }),
  }),
  editableFields: {
    isAllDay: false,
    summary: event.summary,
    ...(event.description && { description: event.description }),
  },
  endTime: event.endTime,
  isKeeperEvent: true,
  startTime: event.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid,
} as RemoteEvent);

interface HarnessInput {
  applyInboundChanges: (input: {
    classifications: Record<string, unknown>[];
    now: Date;
  }) => Promise<{ applied: number; deleteBlocked?: number; failed: number }>;
  localEvents: () => MaterializedSyncableEvent[];
  mappings: Map<string, EventMapping>;
  rawItemCount?: () => number;
  remoteEvents: () => RemoteEvent[];
  writeBackMode: "edits" | "edits_and_deletes";
}

const createPassRunner = (input: HarnessInput) => {
  const pushes: MaterializedSyncableEvent[][] = [];
  const deletes: string[][] = [];
  const wideEvents: Record<string, unknown>[] = [];
  let nextRemoteId = 1;

  const flush = (changes: PendingChanges): Promise<void> => {
    for (const id of changes.deletes) {
      input.mappings.delete(id);
    }
    for (const insert of changes.inserts) {
      const id = `mapping-inserted-${nextRemoteId++}`;
      input.mappings.set(id, { ...insert, id } as EventMapping);
    }
    for (const update of changes.updates ?? []) {
      const mapping = input.mappings.get(update.id);
      if (mapping) {
        input.mappings.set(update.id, { ...mapping, ...update });
      }
    }
    return Promise.resolve();
  };

  const provider = {
    deleteEvents: (eventIds: string[]) => {
      deletes.push([...eventIds]);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve(input.remoteEvents()),
    pushEvents: (events: MaterializedSyncableEvent[]) => {
      pushes.push(events.map((event) => ({ ...event })));
      return Promise.resolve(events.map(() => {
        const remoteId = `pushed-${nextRemoteId++}`;
        return { deleteId: remoteId, remoteId, success: true };
      }));
    },
  };

  const runPass = async (now: Date = PASS_START): Promise<Record<string, unknown>> => {
    await syncCalendar({
      applyInboundChanges: input.applyInboundChanges,
      calendarId: DESTINATION_CALENDAR_ID,
      flush,
      isCurrent: () => Promise.resolve(true),
      now: () => now,
      onSyncEvent: (event: Record<string, unknown>) => wideEvents.push(event),
      provider,
      readState: () => Promise.resolve({
        existingMappings: [...input.mappings.values()],
        localEvents: input.localEvents(),
        remoteEvents: input.remoteEvents(),
        remoteRawItemCount: input.rawItemCount?.() ?? input.remoteEvents().length,
      }),
      reconciliationScope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
          destinationCalendarId: DESTINATION_CALENDAR_ID,
          excludeEventDescription: false,
          excludeEventLocation: false,
          excludeEventName: false,
          sourceCalendarId: SOURCE_CALENDAR_ID,
          ...resolveWriteBackPolicyState(input.writeBackMode, "ok"),
        }]]),
      },
      userId: USER_ID,
    } as never);
    return requireValue(wideEvents.at(-1));
  };

  return { deletes, pushes, runPass, wideEvents };
};

describe("two-way sync: inbound work that cannot complete never starves the destination", () => {
  it("keeps pushing new events while a deletion the probe keeps vetoing sits pending", async () => {
    const mappings = new Map<string, EventMapping>();
    const missingLocalEvent = createLocalEvent({ id: "event-state-missing" });
    mappings.set("mapping-missing", {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: "mirror-missing",
      destinationContentHash: createEditableEventContentHash(missingLocalEvent),
      destinationDescription: "",
      destinationEndTime: END_TIME,
      destinationEventUid: "mirror-missing",
      destinationIsAllDay: false,
      destinationLocation: "",
      destinationStartTime: START_TIME,
      destinationSummary: missingLocalEvent.summary,
      endTime: END_TIME,
      eventStateId: missingLocalEvent.id,
      id: "mapping-missing",
      missingFirstObservedAt: MISSING_FIRST_OBSERVED_AT,
      missingObservationCount: 2,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: START_TIME,
      syncEventHash: createSyncEventContentHash(missingLocalEvent),
      syncEventId: missingLocalEvent.id,
    });

    const unmappedLocalEvent = createLocalEvent({ id: "event-state-new" });
    const blockedClassifications: Record<string, unknown>[][] = [];

    const runner = createPassRunner({
      applyInboundChanges: (input) => {
        blockedClassifications.push(input.classifications);
        return Promise.resolve({ applied: 0, deleteBlocked: 1, failed: 0 });
      },
      localEvents: () => [missingLocalEvent, unmappedLocalEvent],
      mappings,
      rawItemCount: () => TRUNCATED_RAW_ITEM_COUNT,
      remoteEvents: () => [],
      writeBackMode: "edits_and_deletes",
    });

    for (let pass = 0; pass < LIVENESS_PASS_COUNT; pass += 1) {
      await runner.runPass();
    }

    expect(blockedClassifications.length).toBeGreaterThan(0);
    expect(runner.pushes.length).toBeGreaterThan(0);
    expect(runner.pushes.flat().map((event) => event.id)).toContain(unmappedLocalEvent.id);
  });
});

describe("two-way sync: a cross-axis merge still pushes the axis it did not write back", () => {
  it("pushes the source's moved time on the pass after a content-only write-back", async () => {
    const mappings = new Map<string, EventMapping>();
    const mappingId = "mapping-cross-axis";
    const pushedEvent = createLocalEvent({
      description: "Bring the notes",
      id: "event-state-1",
    });
    let localEvent = createLocalEvent({
      description: "Bring the notes",
      endTime: MOVED_END_TIME,
      id: "event-state-1",
      startTime: MOVED_START_TIME,
    });

    mappings.set(mappingId, {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: "mirror-1",
      destinationContentHash: createEditableEventContentHash({
        description: "Bring the notes",
        isAllDay: false,
        summary: pushedEvent.summary,
      }),
      destinationDescription: "Bring the notes",
      destinationEndTime: END_TIME,
      destinationEventUid: "mirror-1",
      destinationIsAllDay: false,
      destinationLocation: "",
      destinationStartTime: START_TIME,
      destinationSummary: pushedEvent.summary,
      endTime: END_TIME,
      eventStateId: pushedEvent.id,
      id: mappingId,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: START_TIME,
      syncEventHash: createSyncEventContentHash(pushedEvent),
      syncEventId: pushedEvent.id,
    });

    const remoteEvent = createRemoteEvent("mirror-1", {
      description: "Bring the laptop",
      endTime: END_TIME,
      startTime: START_TIME,
      summary: pushedEvent.summary,
    });

    const applied: Record<string, unknown>[] = [];
    const runner = createPassRunner({
      applyInboundChanges: (input) => {
        for (const classification of input.classifications) {
          if (classification["type"] !== "write-back") {
            continue;
          }
          applied.push(classification);
          const mapping = requireValue(mappings.get(String(classification["mappingId"])));
          const updates = classification["updates"] as Record<string, unknown>;
          localEvent = { ...localEvent, ...updates } as MaterializedSyncableEvent;
          const observed = classification["observed"] as Record<string, unknown>;
          mappings.set(mapping.id, {
            ...mapping,
            destinationContentHash: observed["contentHash"] as string,
            destinationDescription: observed["description"] as string,
            destinationEndTime: observed["endTime"] as Date,
            destinationIsAllDay: observed["isAllDay"] as boolean,
            destinationLocation: observed["location"] as string,
            destinationStartTime: observed["startTime"] as Date,
            destinationSummary: observed["summary"] as string,
            syncEventHash: classification["projectedSyncEventHash"] as string,
          });
        }
        return Promise.resolve({ applied: applied.length, failed: 0 });
      },
      localEvents: () => [localEvent],
      mappings,
      remoteEvents: () => [remoteEvent],
      writeBackMode: "edits",
    });

    await runner.runPass();
    expect(applied).toHaveLength(1);
    expect(Object.keys(requireValue(applied[0])["updates"] as object)).toEqual(["description"]);

    await runner.runPass();

    expect(runner.pushes.flat().map((event) => event.startTime)).toContainEqual(
      MOVED_START_TIME,
    );
  });

  it("pushes the source's edited title on the pass after a schedule-only write-back", async () => {
    const mappings = new Map<string, EventMapping>();
    const mappingId = "mapping-schedule-axis";
    const pushedEvent = createLocalEvent({ id: "event-state-1" });
    let localEvent = createLocalEvent({
      id: "event-state-1",
      summary: "Quarterly review with the board",
    });

    mappings.set(mappingId, {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: "mirror-1",
      destinationContentHash: createEditableEventContentHash({
        isAllDay: false,
        summary: pushedEvent.summary,
      }),
      destinationDescription: "",
      destinationEndTime: END_TIME,
      destinationEventUid: "mirror-1",
      destinationIsAllDay: false,
      destinationLocation: "",
      destinationStartTime: START_TIME,
      destinationSummary: pushedEvent.summary,
      endTime: END_TIME,
      eventStateId: pushedEvent.id,
      id: mappingId,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: START_TIME,
      syncEventHash: createSyncEventContentHash(pushedEvent),
      syncEventId: pushedEvent.id,
    });

    const remoteEvent = createRemoteEvent("mirror-1", {
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
      summary: pushedEvent.summary,
    });

    const applied: Record<string, unknown>[] = [];
    const runner = createPassRunner({
      applyInboundChanges: (input) => {
        for (const classification of input.classifications) {
          if (classification["type"] !== "write-back") {
            continue;
          }
          applied.push(classification);
          const mapping = requireValue(mappings.get(String(classification["mappingId"])));
          const updates = classification["updates"] as Record<string, unknown>;
          localEvent = { ...localEvent, ...updates } as MaterializedSyncableEvent;
          const observed = classification["observed"] as Record<string, unknown>;
          mappings.set(mapping.id, {
            ...mapping,
            destinationContentHash: observed["contentHash"] as string,
            destinationDescription: observed["description"] as string,
            destinationEndTime: observed["endTime"] as Date,
            destinationIsAllDay: observed["isAllDay"] as boolean,
            destinationLocation: observed["location"] as string,
            destinationStartTime: observed["startTime"] as Date,
            destinationSummary: observed["summary"] as string,
            endTime: updates["endTime"] as Date,
            startTime: updates["startTime"] as Date,
            syncEventHash: classification["projectedSyncEventHash"] as string | null,
          });
        }
        return Promise.resolve({ applied: applied.length, failed: 0 });
      },
      localEvents: () => [localEvent],
      mappings,
      remoteEvents: () => [remoteEvent],
      writeBackMode: "edits",
    });

    await runner.runPass();
    expect(applied).toHaveLength(1);
    expect(Object.keys(requireValue(applied[0])["updates"] as object).toSorted()).toEqual([
      "endTime",
      "isAllDay",
      "startTime",
    ]);

    await runner.runPass();

    expect(runner.pushes.flat().map((event) => event.summary)).toContain(
      "Quarterly review with the board",
    );
  });
});

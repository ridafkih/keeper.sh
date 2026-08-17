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
const SECOND_DESTINATION_CALENDAR_ID = "second-destination-calendar";
const USER_ID = "user-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const PASS_START = new Date("2027-05-01T09:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const GRACE_MS = 10 * MINUTE_MS;
const EPOCH_QUARANTINE_LIMIT = 5;
const ADVERSARIAL_PASS_COUNT = 20;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface SourceRow {
  description: string | null;
  endTime: Date;
  id: string;
  isAllDay: boolean;
  location: string | null;
  sourceEventUid: string;
  startTime: Date;
  title: string;
}

interface PrivacySettings {
  customEventName: string;
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
}

interface SourceWrite {
  kind: "delete" | "update";
  sourceEventUid: string;
  updates?: Record<string, unknown>;
}

const OPEN_PRIVACY: PrivacySettings = {
  customEventName: "{{calendar_name}}",
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

const REDACTED_PRIVACY: PrivacySettings = {
  customEventName: "{{calendar_name}}",
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
};

const requireValue = <TValue>(value?: TValue | null): TValue => {
  if (!value) {
    throw new Error("Expected two-way harness value to exist");
  }
  return value;
};

class SourceCalendarStore {
  public readonly rows = new Map<string, SourceRow>();
  public readonly writes: SourceWrite[] = [];
  public readonly tombstones: { sourceEventUid: string; title: string }[] = [];
  public privacy: PrivacySettings = OPEN_PRIVACY;

  public seed = (row: SourceRow): void => {
    this.rows.set(row.id, row);
  };

  public editLocally = (id: string, patch: Partial<SourceRow>): void => {
    this.rows.set(id, { ...requireValue(this.rows.get(id)), ...patch });
  };

  public applyUpdate = (sourceEventUid: string, updates: Record<string, unknown>): void => {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.sourceEventUid === sourceEventUid,
    );
    this.writes.push({ kind: "update", sourceEventUid, updates });
    if (!row) {
      throw new Error(`No source row for ${sourceEventUid}`);
    }
    this.rows.set(row.id, {
      ...row,
      ...("description" in updates && { description: updates.description as string }),
      ...("endTime" in updates && { endTime: updates.endTime as Date }),
      ...("isAllDay" in updates && { isAllDay: updates.isAllDay as boolean }),
      ...("location" in updates && { location: updates.location as string }),
      ...("startTime" in updates && { startTime: updates.startTime as Date }),
      ...("summary" in updates && { title: updates.summary as string }),
    });
  };

  public applyDelete = (sourceEventUid: string): void => {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.sourceEventUid === sourceEventUid,
    );
    this.writes.push({ kind: "delete", sourceEventUid });
    if (!row) {
      throw new Error(`No source row for ${sourceEventUid}`);
    }
    this.tombstones.push({ sourceEventUid, title: row.title });
    this.rows.delete(row.id);
  };

  public syncableEvents = (): MaterializedSyncableEvent[] =>
    [...this.rows.values()].map((row) => {
      let summary = row.title;
      if (this.privacy.excludeEventName) {
        summary = this.privacy.customEventName.replace("{{calendar_name}}", "Personal");
      }
      return {
        availability: "busy",
        calendarId: SOURCE_CALENDAR_ID,
        calendarName: "Personal",
        calendarUrl: null,
        endTime: row.endTime,
        eventStateId: row.id,
        id: row.id,
        isAllDay: row.isAllDay,
        sourceEventUid: row.sourceEventUid,
        startTime: row.startTime,
        summary,
        ...(!this.privacy.excludeEventDescription && row.description
          && { description: row.description }),
        ...(!this.privacy.excludeEventLocation && row.location
          && { location: row.location }),
      } satisfies MaterializedSyncableEvent;
    });
}

interface RemoteRecord {
  description?: string;
  endTime: Date;
  isAllDay: boolean;
  location?: string;
  startTime: Date;
  summary: string;
}

class DestinationCalendarStore {
  public readonly remote = new Map<string, RemoteRecord>();
  public readonly pushes: MaterializedSyncableEvent[][] = [];
  public readonly deletes: string[][] = [];
  public readonly unmappedRemoteIds = new Set<string>();
  public failNextRead = false;
  public hideEverything = false;
  public rawItemCountOverride: number | null = null;
  public normalizeOnRead: ((record: RemoteRecord) => RemoteRecord) | null = null;
  private nextRemoteId = 1;

  public deleteEvents = (eventIds: string[]) => {
    this.deletes.push([...eventIds]);
    for (const id of eventIds) {
      this.remote.delete(id);
      this.unmappedRemoteIds.delete(id);
    }
    return Promise.resolve(eventIds.map(() => ({ success: true })));
  };

  public pushEvents = (events: MaterializedSyncableEvent[]) => {
    this.pushes.push(events.map((event) => ({ ...event })));
    return Promise.resolve(events.map((event) => {
      const remoteId = `remote-${this.nextRemoteId++}`;
      this.remote.set(remoteId, {
        endTime: event.endTime,
        isAllDay: event.isAllDay ?? false,
        startTime: event.startTime,
        summary: event.summary,
        ...(event.description && { description: event.description }),
        ...(event.location && { location: event.location }),
      });
      if (!this.echoStoredEvent) {
        return { deleteId: remoteId, remoteId, success: true };
      }
      const stored = this.remote.get(remoteId);
      const record = this.storedAsRead(stored);
      return {
        deleteId: remoteId,
        remoteId,
        storedEvent: record && {
          deleteId: remoteId,
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
          uid: remoteId,
        } as RemoteEvent,
        success: true,
      };
    }));
  };

  public echoStoredEvent = false;

  private storedAsRead(stored: RemoteRecord | undefined): RemoteRecord | undefined {
    if (!stored || !this.normalizeOnRead) {
      return stored;
    }
    return this.normalizeOnRead(stored);
  }

  public listRemoteEvents = (): Promise<RemoteEvent[]> => {
    if (this.failNextRead) {
      this.failNextRead = false;
      return Promise.reject(new Error("injected destination read failure"));
    }
    if (this.hideEverything) {
      return Promise.resolve([]);
    }
    return Promise.resolve([...this.remote.entries()].map(([uid, stored]) => {
      let record = stored;
      if (this.normalizeOnRead) {
        record = this.normalizeOnRead(stored);
      }
      return {
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
        isKeeperEvent: !this.unmappedRemoteIds.has(uid),
        startTime: record.startTime,
        supportedAvailabilities: ["busy", "free"],
        uid,
      } as RemoteEvent;
    }));
  };

  public rawItemCount = (): number => {
    if (this.rawItemCountOverride !== null) {
      return this.rawItemCountOverride;
    }
    return this.remote.size;
  };

  public editMirror = (patch: Partial<RemoteRecord>): void => {
    const [uid, record] = requireValue([...this.remote.entries()][0]);
    this.remote.set(uid, { ...record, ...patch });
  };

  public deleteMirror = (): void => {
    const [uid] = requireValue([...this.remote.entries()][0]);
    this.remote.delete(uid);
  };

  public resetCalls = (): void => {
    this.pushes.length = 0;
    this.deletes.length = 0;
  };
}

class MappingStore {
  private nextId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const id of changes.deletes) {
      this.mappings.delete(id);
    }
    for (const insert of changes.inserts) {
      const id = `mapping-${this.nextId++}`;
      this.mappings.set(id, { ...insert, id } as EventMapping);
    }
    for (const update of changes.updates ?? []) {
      const mapping = this.mappings.get(update.id);
      if (mapping) {
        this.mappings.set(update.id, { ...mapping, ...update });
      }
    }
    return Promise.resolve();
  };

  public list = (): EventMapping[] => [...this.mappings.values()];

  public only = (): Record<string, unknown> =>
    requireValue(this.list()[0]) as unknown as Record<string, unknown>;
}

interface Classification {
  expectedSyncEventHash?: string | null;
  mappingId: string;
  observed?: {
    availability?: string;
    contentHash?: string;
    endTime?: Date;
    startTime?: Date;
  };
  projectedSyncEventHash?: string;
  sourceEventUid?: string;
  type: string;
  updates?: Record<string, unknown>;
}

const EPOCH_WINDOW_MS = 60 * MINUTE_MS;

/*
 * The real applier lives in the sync package, which this one cannot import. It stands in
 * for exactly the observable contract the classifier depends on: the epoch window rolls
 * rather than staying pinned to the first write-back, and a write is abandoned when the
 * mapping moved since it was classified.
 */
const createApplier = (source: SourceCalendarStore, mappings: MappingStore) => {
  const calls: Classification[][] = [];

  const bumpEpoch = (
    mapping: Record<string, unknown>,
    now: Date,
  ): {
    writeBackAppliedCount: number;
    writeBackEpoch: number;
    writeBackEpochWindowStart: Date;
    writeBackLastAppliedAt: Date;
  } => {
    const windowStart = mapping["writeBackEpochWindowStart"];
    const staleWindow = !(windowStart instanceof Date)
      || now.getTime() - windowStart.getTime() >= EPOCH_WINDOW_MS;
    if (staleWindow) {
      return {
        writeBackAppliedCount: 1,
        writeBackEpoch: 1,
        writeBackEpochWindowStart: now,
        writeBackLastAppliedAt: now,
      };
    }
    return {
      writeBackAppliedCount: Number(mapping["writeBackAppliedCount"] ?? 0) + 1,
      writeBackEpoch: Number(mapping["writeBackEpoch"] ?? 0) + 1,
      writeBackEpochWindowStart: windowStart,
      writeBackLastAppliedAt: now,
    };
  };

  const applyInboundChanges = (input: {
    classifications: Classification[];
    now?: Date;
  }) => {
    const now = input.now ?? PASS_START;
    calls.push(input.classifications.map((classification) => ({ ...classification })));
    let applied = 0;
    for (const classification of input.classifications) {
      const mapping = mappings.mappings.get(classification.mappingId) as
        | (EventMapping & Record<string, unknown>)
        | undefined;
      if (mapping && mapping.syncEventHash !== classification.expectedSyncEventHash) {
        continue;
      }
      if (classification.type === "write-back") {
        source.applyUpdate(
          requireValue(classification.sourceEventUid),
          requireValue(classification.updates),
        );
        applied += 1;
        if (mapping) {
          mappings.mappings.set(classification.mappingId, {
            ...mapping,
            destinationAvailability: classification.observed?.availability,
            destinationContentHash: classification.observed?.contentHash,
            destinationEndTime: classification.observed?.endTime,
            destinationStartTime: classification.observed?.startTime,
            syncEventHash: requireValue(classification.projectedSyncEventHash),
            ...bumpEpoch(mapping, now),
            ...(classification.updates?.["startTime"] instanceof Date && {
              startTime: classification.updates["startTime"],
            }),
            ...(classification.updates?.["endTime"] instanceof Date && {
              endTime: classification.updates["endTime"],
            }),
          } as unknown as EventMapping);
        }
      }
      if (classification.type === "delete") {
        source.applyDelete(requireValue(classification.sourceEventUid));
        applied += 1;
        mappings.mappings.delete(classification.mappingId);
      }
    }
    return Promise.resolve({ applied, failed: 0 });
  };

  return { applyInboundChanges, calls };
};

interface PassHarness {
  applierCalls: Classification[][];
  confirmationRequests: string[];
  writeBackState: () => string;
  destination: DestinationCalendarStore;
  mappings: MappingStore;
  runPass: (now?: Date) => Promise<Record<string, unknown>>;
  source: SourceCalendarStore;
  wideEvents: Record<string, unknown>[];
}

const createHarness = (options: {
  calendarId?: string;
  privacy?: PrivacySettings;
  source?: SourceCalendarStore;
  writeBackMode: "edits" | "edits_and_deletes" | "off";
}): PassHarness => {
  const source = options.source ?? new SourceCalendarStore();
  source.privacy = options.privacy ?? OPEN_PRIVACY;
  const destination = new DestinationCalendarStore();
  const mappings = new MappingStore();
  const { applyInboundChanges, calls } = createApplier(source, mappings);
  const confirmationRequests: string[] = [];
  const wideEvents: Record<string, unknown>[] = [];
  const calendarId = options.calendarId ?? DESTINATION_CALENDAR_ID;

  /*
   * The state a confirmation request writes is read back on the next pass, exactly as
   * production reads it: a harness that pins the policy cannot see what the transition
   * does to the passes that follow it.
   */
  let writeBackState = "ok";

  const runPass = async (now: Date = PASS_START): Promise<Record<string, unknown>> => {
    await syncCalendar({
      applyInboundChanges,
      calendarId,
      flush: mappings.flush,
      requestDeleteConfirmation: (request: { reason: string }) => {
        writeBackState = "delete_confirmation_required";
        confirmationRequests.push(request.reason);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      now: () => now,
      onSyncEvent: (event: Record<string, unknown>) => wideEvents.push(event),
      provider: destination,
      readState: async () => ({
        existingMappings: mappings.list(),
        localEvents: source.syncableEvents(),
        remoteEvents: await destination.listRemoteEvents(),
        remoteRawItemCount: destination.rawItemCount(),
      }),
      reconciliationScope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
          destinationCalendarId: calendarId,
          excludeEventDescription: source.privacy.excludeEventDescription,
          excludeEventLocation: source.privacy.excludeEventLocation,
          excludeEventName: source.privacy.excludeEventName,
          sourceCalendarId: SOURCE_CALENDAR_ID,
          ...resolveWriteBackPolicyState(options.writeBackMode, writeBackState),
        }]]),
      },
      userId: USER_ID,
    } as never);
    return requireValue(wideEvents.at(-1));
  };

  return {
    applierCalls: calls,
    confirmationRequests,
    destination,
    mappings,
    runPass,
    source,
    wideEvents,
    writeBackState: () => writeBackState,
  };
};

const seedOrdinaryEvent = (source: SourceCalendarStore): SourceRow => {
  const row: SourceRow = {
    description: "Bring the notes",
    endTime: END_TIME,
    id: "event-state-1",
    isAllDay: false,
    location: "Room 4",
    sourceEventUid: "source-event-uid-1",
    startTime: START_TIME,
    title: "Quarterly review",
  };
  source.seed(row);
  return row;
};

describe("two-way sync: an edit on the mirror reaches the original", () => {
  it("propagates title, description, location and time back to the source event", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.resetCalls();

    harness.destination.editMirror({
      description: "Bring the revised notes",
      endTime: MOVED_END_TIME,
      location: "Room 9",
      startTime: MOVED_START_TIME,
      summary: "Quarterly review with Dana",
    });

    const wideEvent = await harness.runPass();

    expect(harness.source.writes).toMatchObject([{
      kind: "update",
      sourceEventUid: "source-event-uid-1",
      updates: {
        description: "Bring the revised notes",
        endTime: MOVED_END_TIME,
        location: "Room 9",
        startTime: MOVED_START_TIME,
        summary: "Quarterly review with Dana",
      },
    }]);
    expect(requireValue(harness.source.rows.get("event-state-1"))).toMatchObject({
      description: "Bring the revised notes",
      location: "Room 9",
      startTime: MOVED_START_TIME,
      title: "Quarterly review with Dana",
    });
    expect(wideEvent.outcome).toBe("write_back_applied");
    expect(harness.destination.pushes).toEqual([]);
  });

  it("writes a redacted mapping's time back while leaving the real title alone", async () => {
    const harness = createHarness({
      privacy: REDACTED_PRIVACY,
      writeBackMode: "edits",
    });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.editMirror({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
      summary: "Dentist",
    });
    await harness.runPass();

    expect(harness.source.writes).toHaveLength(1);
    expect(requireValue(harness.source.writes[0]).updates).toEqual({
      endTime: MOVED_END_TIME,
      isAllDay: false,
      startTime: MOVED_START_TIME,
    });
    expect(requireValue(harness.source.rows.get("event-state-1")).title)
      .toBe("Quarterly review");
  });
});

describe("two-way sync: termination", () => {
  it("settles after a single source write and stays quiescent", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.editMirror({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
      summary: "Moved by the user",
    });

    for (let pass = 0; pass < 6; pass++) {
      await harness.runPass();
    }

    expect(harness.source.writes).toHaveLength(1);
    expect(harness.applierCalls.filter((call) => call.length > 0)).toHaveLength(1);

    harness.destination.resetCalls();
    await harness.runPass();
    await harness.runPass();

    expect(harness.destination.pushes).toEqual([]);
    expect(harness.destination.deletes).toEqual([]);
    expect(harness.source.writes).toHaveLength(1);
  });

  /*
   * The hole this closes. Without a witness the first read of a copy has to guess whether a
   * difference is the provider re-encoding what we sent or the user editing it, and neither
   * answer is safe: adopting leaves the two calendars disagreeing for good, rebuilding loops
   * against any destination that normalises. A provider that says what it stored removes the
   * question — the copy is on record before anyone could touch it.
   */
  it("writes back an edit made before the copy was ever read", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    harness.destination.echoStoredEvent = true;
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    harness.destination.editMirror({ summary: "Moved by the user" });
    await harness.runPass();

    expect(harness.source.writes).toHaveLength(1);
  });

  it("still swallows that edit when the provider does not say what it stored", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    harness.destination.editMirror({ summary: "Moved by the user" });
    await harness.runPass();

    expect(harness.source.writes).toEqual([]);
  });

  it("absorbs a normalizing destination exactly once and never writes to the source", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);
    harness.destination.normalizeOnRead = (record) => ({
      ...record,
      summary: record.summary.toLowerCase(),
    });

    for (let pass = 0; pass < 5; pass++) {
      await harness.runPass();
    }

    expect(harness.source.writes).toEqual([]);
    expect(harness.destination.pushes).toHaveLength(1);
  });

  it("never moves a real event because the destination normalized an all-day date", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    harness.source.seed({
      description: null,
      endTime: new Date("2027-05-12T05:00:00.000Z"),
      id: "event-state-1",
      isAllDay: true,
      location: null,
      sourceEventUid: "source-event-uid-1",
      startTime: new Date("2027-05-11T05:00:00.000Z"),
      title: "Conference day",
    });
    harness.destination.normalizeOnRead = (record) => ({
      ...record,
      endTime: new Date(`${record.endTime.toISOString().slice(0, 10)}T00:00:00.000Z`),
      startTime: new Date(`${record.startTime.toISOString().slice(0, 10)}T00:00:00.000Z`),
    });

    for (let pass = 0; pass < 5; pass++) {
      await harness.runPass();
    }

    expect(harness.source.writes).toEqual([]);
    expect(requireValue(harness.source.rows.get("event-state-1")).startTime)
      .toEqual(new Date("2027-05-11T05:00:00.000Z"));
    expect(harness.mappings.only().destinationStartTime)
      .toEqual(new Date("2027-05-11T00:00:00.000Z"));
  });

  it("stops writing back once an adversarial destination trips the epoch budget", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);
    let mutation = 0;
    harness.destination.normalizeOnRead = (record) => ({
      ...record,
      summary: `${record.summary} ${mutation++}`,
    });

    for (let pass = 0; pass < ADVERSARIAL_PASS_COUNT; pass++) {
      await harness.runPass();
    }

    expect(harness.source.writes.length).toBeGreaterThanOrEqual(1);
    expect(harness.source.writes.length).toBeLessThanOrEqual(EPOCH_QUARANTINE_LIMIT);

    const writesBeforeSettling = harness.source.writes.length;
    await harness.runPass();
    await harness.runPass();

    expect(harness.source.writes).toHaveLength(writesBeforeSettling);
  });

  /*
   * A rolling window must not hand a breached mapping a fresh budget every hour: the
   * destination is still varying on every read, and one unattended write per pass is the
   * runaway the budget exists to stop.
   */
  it("keeps an adversarial destination quarantined as the epoch window rolls past", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);
    let mutation = 0;
    harness.destination.normalizeOnRead = (record) => ({
      ...record,
      summary: `${record.summary} ${mutation++}`,
    });

    for (let pass = 0; pass < ADVERSARIAL_PASS_COUNT; pass++) {
      await harness.runPass();
    }
    const writesInsideTheWindow = harness.source.writes.length;

    for (let day = 1; day <= 24; day++) {
      await harness.runPass(new Date(PASS_START.getTime() + day * HOUR_MS));
    }

    expect(harness.source.writes).toHaveLength(writesInsideTheWindow);
    expect(harness.source.writes.length).toBeLessThanOrEqual(EPOCH_QUARANTINE_LIMIT);
  });
});

describe("two-way sync: our own write is not a user edit", () => {
  it("pushes a source-side edit outward and writes nothing back", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.resetCalls();
    harness.source.editLocally("event-state-1", { title: "Renamed on the source" });

    await harness.runPass();
    await harness.runPass();
    await harness.runPass();

    expect(harness.source.writes).toEqual([]);
    expect(harness.destination.pushes).toHaveLength(1);
    expect(requireValue(harness.destination.pushes[0])[0]?.summary)
      .toBe("Renamed on the source");
  });
});

describe("two-way sync: both sides changed since our last write", () => {
  it("resolves in favour of the source without consulting any provider clock", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.resetCalls();

    harness.source.editLocally("event-state-1", { title: "Renamed on the source" });
    harness.destination.editMirror({ summary: "Renamed on the destination" });

    const wideEvent = await harness.runPass();

    expect(harness.source.writes).toEqual([]);
    expect(harness.destination.pushes).toHaveLength(1);
    expect(wideEvent["two_way.conflict_source_wins_count"]).toBe(1);

    await harness.runPass();
    await harness.runPass();

    expect(harness.source.writes).toEqual([]);
    expect([...harness.destination.remote.values()][0]?.summary)
      .toBe("Renamed on the source");
  });
});

describe("two-way sync: deletion of the mirror", () => {
  it("waits for a corroborating observation and the grace window before deleting", async () => {
    const harness = createHarness({ writeBackMode: "edits_and_deletes" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.resetCalls();
    harness.destination.deleteMirror();
    harness.destination.rawItemCountOverride = 4;

    await harness.runPass(PASS_START);

    expect(harness.source.writes).toEqual([]);
    expect(harness.destination.pushes).toEqual([]);
    expect(harness.source.rows.has("event-state-1")).toBe(true);

    await harness.runPass(new Date(PASS_START.getTime() + 3 * MINUTE_MS));

    expect(harness.source.writes).toEqual([]);

    await harness.runPass(new Date(PASS_START.getTime() + GRACE_MS + MINUTE_MS));

    expect(harness.source.writes).toMatchObject([{
      kind: "delete",
      sourceEventUid: "source-event-uid-1",
    }]);
    expect(harness.source.tombstones).toMatchObject([{ title: "Quarterly review" }]);
    expect(harness.source.rows.has("event-state-1")).toBe(false);
  });

  it("records the real title in the deletion record on a redacted mapping", async () => {
    const harness = createHarness({
      privacy: REDACTED_PRIVACY,
      writeBackMode: "edits_and_deletes",
    });
    harness.source.seed({
      description: "Bring the x-rays",
      endTime: END_TIME,
      id: "event-state-1",
      isAllDay: false,
      location: "Suite 300",
      sourceEventUid: "source-event-uid-1",
      startTime: START_TIME,
      title: "Root canal, Dr. Chen",
    });

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.deleteMirror();
    harness.destination.rawItemCountOverride = 4;

    await harness.runPass(PASS_START);
    await harness.runPass(new Date(PASS_START.getTime() + GRACE_MS + MINUTE_MS));

    expect(harness.source.tombstones).toMatchObject([{ title: "Root canal, Dr. Chen" }]);
  });

  it("never deletes the original when the mapping only propagates edits", async () => {
    const harness = createHarness({ writeBackMode: "edits" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.deleteMirror();

    await harness.runPass(new Date(PASS_START.getTime() + GRACE_MS + MINUTE_MS));
    await harness.runPass(new Date(PASS_START.getTime() + 2 * GRACE_MS));

    expect(harness.source.writes).toEqual([]);
    expect(harness.source.rows.has("event-state-1")).toBe(true);
  });
});

describe("two-way sync: an unreadable destination is not a deletion", () => {
  it("applies nothing at all when the destination read fails", async () => {
    const harness = createHarness({ writeBackMode: "edits_and_deletes" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.resetCalls();
    harness.destination.failNextRead = true;

    await expect(harness.runPass(PASS_START)).rejects.toThrow(
      "injected destination read failure",
    );

    expect(harness.applierCalls.filter((call) => call.length > 0)).toEqual([]);
    expect(harness.source.writes).toEqual([]);
    expect(harness.mappings.only().missingObservationCount ?? 0).toBe(0);
  });

  it("does not delete the originals when the destination returns nothing at all", async () => {
    const harness = createHarness({ writeBackMode: "edits_and_deletes" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.resetCalls();
    harness.destination.hideEverything = true;
    harness.destination.rawItemCountOverride = 0;

    await harness.runPass(PASS_START);
    await harness.runPass(new Date(PASS_START.getTime() + GRACE_MS + MINUTE_MS));
    await harness.runPass(new Date(PASS_START.getTime() + 2 * GRACE_MS));

    expect(harness.source.writes).toEqual([]);
    expect(harness.source.rows.has("event-state-1")).toBe(true);
    expect(harness.destination.pushes).toEqual([]);
    expect(requireValue(harness.wideEvents.at(-1))["two_way.ambiguous_empty_read_count"])
      .toBe(1);
  });

  it("holds the copies and the pending state while it waits for an answer", async () => {
    const harness = createHarness({ writeBackMode: "edits_and_deletes" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass(PASS_START);
    await harness.runPass(PASS_START);
    harness.destination.resetCalls();
    harness.destination.hideEverything = true;
    harness.destination.rawItemCountOverride = 0;

    for (let pass = 0; pass < ADVERSARIAL_PASS_COUNT; pass += 1) {
      await harness.runPass(new Date(PASS_START.getTime() + pass * GRACE_MS));
    }

    expect(harness.confirmationRequests[0]).toBe("all_copies_missing");
    expect(harness.writeBackState()).toBe("delete_confirmation_required");
    expect(harness.source.writes).toEqual([]);
    expect(harness.source.rows.has("event-state-1")).toBe(true);
    expect(harness.destination.pushes).toEqual([]);
    expect(harness.destination.deletes).toEqual([]);
    expect(harness.mappings.only()).toBeDefined();
  });
});

describe("two-way sync: fan-out", () => {
  it("reaches the source and the other destination without echoing to the origin", async () => {
    const source = new SourceCalendarStore();
    seedOrdinaryEvent(source);
    const twoWay = createHarness({ source, writeBackMode: "edits" });
    const oneWay = createHarness({
      calendarId: SECOND_DESTINATION_CALENDAR_ID,
      source,
      writeBackMode: "off",
    });

    await twoWay.runPass();
    await oneWay.runPass();
    await twoWay.runPass();
    await oneWay.runPass();
    twoWay.destination.resetCalls();
    oneWay.destination.resetCalls();

    twoWay.destination.editMirror({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
      summary: "Moved on the mirror",
    });

    await twoWay.runPass();

    expect(source.writes).toHaveLength(1);
    expect(twoWay.destination.pushes).toEqual([]);

    await oneWay.runPass();

    expect(oneWay.destination.pushes).toHaveLength(1);
    expect(requireValue(oneWay.destination.pushes[0])[0]).toMatchObject({
      startTime: MOVED_START_TIME,
      summary: "Moved on the mirror",
    });

    twoWay.destination.resetCalls();
    oneWay.destination.resetCalls();
    await twoWay.runPass();
    await oneWay.runPass();
    await twoWay.runPass();

    expect(source.writes).toHaveLength(1);
    expect(twoWay.destination.pushes).toEqual([]);
    expect(oneWay.destination.pushes).toEqual([]);
  });
});

describe("two-way sync: the mirror the user owns is still never deleted", () => {
  it("leaves an unmapped non-Keeper event on a two-way destination alone", async () => {
    const harness = createHarness({ writeBackMode: "edits_and_deletes" });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    harness.destination.remote.set("user-owned-event", {
      endTime: END_TIME,
      isAllDay: false,
      startTime: START_TIME,
      summary: "The user's own event",
    });
    harness.destination.unmappedRemoteIds.add("user-owned-event");
    harness.destination.resetCalls();

    await harness.runPass();
    await harness.runPass();

    expect(harness.destination.remote.has("user-owned-event")).toBe(true);
    expect(harness.source.writes).toEqual([]);
  });
});

describe("two-way sync: the projected hash suppresses the echo", () => {
  it("records the hash the reconcile path will compute for the updated source row", async () => {
    const harness = createHarness({
      privacy: REDACTED_PRIVACY,
      writeBackMode: "edits",
    });
    seedOrdinaryEvent(harness.source);

    await harness.runPass();
    await harness.runPass();
    harness.destination.editMirror({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    });
    await harness.runPass();

    const projected = requireValue(harness.source.syncableEvents()[0]);

    expect(harness.source.writes).toHaveLength(1);
    expect(projected.startTime).toEqual(MOVED_START_TIME);
    expect(harness.mappings.only().syncEventHash)
      .toBe(createSyncEventContentHash(projected));
  });
});

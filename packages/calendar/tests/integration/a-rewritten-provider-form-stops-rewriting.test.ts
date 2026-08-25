import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingChanges } from "../../src/core/sync-engine/types";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";

/* A form that settles once and then holds still may cost a repair or two; it may not cost one forever. */
const SETTLING_PASS_BUDGET = 3;
const TOTAL_PASSES = 8;

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

interface StoredDestinationEvent {
  description: string;
  endTime: Date;
  location: string;
  startTime: Date;
  summary: string;
  uid: string;
}

const snapshotOf = (stored: StoredDestinationEvent) =>
  createEditableEventContentSnapshot({
    description: stored.description,
    location: stored.location,
    summary: stored.summary,
  });

const contentHashOf = (stored: StoredDestinationEvent): string =>
  hashEditableEventContentSnapshot(snapshotOf(stored));

const toRemoteEvent = (stored: StoredDestinationEvent): RemoteEvent => {
  const content = snapshotOf(stored);

  return {
    deleteId: stored.uid,
    editableAvailability: "busy",
    editableContent: content,
    editableContentHash: hashEditableEventContentSnapshot(content),
    endTime: stored.endTime,
    isKeeperEvent: true,
    startTime: stored.startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: stored.uid,
  };
};

/*
 * How the destination hands back the form it kept: Google and Outlook echo it on the write
 * itself, a CalDAV server is read back afterwards.
 */
type CaptureChannel = "echo" | "read-back";

type SettleForm = (stored: StoredDestinationEvent) => StoredDestinationEvent;

/*
 * A destination that rewrites what we wrote into its own storage form: the capture is handed
 * the text as it was submitted, every later read sees the rewritten form, and rewriting the
 * same text again reproduces exactly that same form.
 */
class RewritingDestination {
  private nextRemoteId = 1;
  private readonly stored = new Map<string, StoredDestinationEvent>();
  private readonly captureChannel: CaptureChannel;
  private readonly settle: SettleForm;
  public readonly pushedEventIds: string[] = [];
  public readonly deletedIds: string[] = [];

  public constructor(captureChannel: CaptureChannel, settle: SettleForm) {
    this.captureChannel = captureChannel;
    this.settle = settle;
  }

  public pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
    Promise.resolve(events.map((event): PushResult => {
      this.pushedEventIds.push(event.id);
      const uid = `remote-uid-${this.nextRemoteId}`;
      this.nextRemoteId += 1;
      const submitted: StoredDestinationEvent = {
        description: event.description ?? "",
        endTime: event.endTime,
        location: event.location ?? "",
        startTime: event.startTime,
        summary: event.summary,
        uid,
      };
      this.stored.set(uid, submitted);
      return {
        deleteId: uid,
        remoteId: uid,
        success: true,
        ...this.echoedForm(submitted),
      };
    }));

  public deleteEvents = (deleteIds: string[]): Promise<DeleteResult[]> =>
    Promise.resolve(deleteIds.map((deleteId): DeleteResult => {
      this.deletedIds.push(deleteId);
      this.stored.delete(deleteId);
      return { success: true };
    }));

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(this.snapshot());

  /* Every read after the write sees the rewritten form, and it is the same form every time. */
  public snapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(this.settle(stored)));

  /* What the capture is handed: the text exactly as it was submitted, before the rewrite. */
  public submittedSnapshot = (): RemoteEvent[] =>
    [...this.stored.values()].map((stored) => toRemoteEvent(stored));

  public resetCalls = (): void => {
    this.pushedEventIds.length = 0;
    this.deletedIds.length = 0;
  };

  private echoedForm = (submitted: StoredDestinationEvent): { storedContentHash?: string } => {
    if (this.captureChannel !== "echo") {
      return {};
    }
    return { storedContentHash: contentHashOf(submitted) };
  };
}

/* The CalDAV shape is read back by id after the write, and that read is the early one. */
const buildProvider = (
  destination: RewritingDestination,
  captureChannel: CaptureChannel,
): CalendarSyncProvider => {
  if (captureChannel !== "read-back") {
    return destination;
  }
  return {
    ...destination,
    getRemoteEventsByIds: (eventIds: string[]): Promise<RemoteEvent[]> =>
      Promise.resolve(destination.submittedSnapshot().filter((remote) =>
        eventIds.includes(remote.uid) || eventIds.includes(remote.deleteId))),
  };
};

class MappingStore {
  private nextMappingId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public read = (): EventMapping[] => [...this.mappings.values()];

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const mappingId of changes.deletes) {
      this.mappings.delete(mappingId);
    }

    for (const insert of changes.inserts) {
      const mappingId = `mapping-${this.nextMappingId}`;
      this.nextMappingId += 1;
      this.mappings.set(mappingId, { ...insert, id: mappingId });
    }

    for (const update of changes.updates ?? []) {
      const existing = this.mappings.get(update.id);
      if (!existing) {
        continue;
      }
      this.mappings.set(update.id, { ...existing, ...update });
    }

    return Promise.resolve();
  };
}

const reconcile = (
  destination: RewritingDestination,
  provider: CalendarSyncProvider,
  mappingStore: MappingStore,
  localEvent: MaterializedSyncableEvent,
) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: mappingStore.flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: () => Promise.resolve({
      existingMappings: mappingStore.read(),
      localEvents: [localEvent],
      remoteEvents: destination.snapshot(),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

const localEventWith = (
  fields: { description: string; location: string; summary: string },
): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source calendar",
  calendarUrl: null,
  description: fields.description,
  endTime: new Date("2026-05-14T10:00:00.000Z"),
  id: "sync-event-1",
  location: fields.location,
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-05-14T09:00:00.000Z"),
  summary: fields.summary,
});

interface DestinationShape {
  captureChannel: CaptureChannel;
  localEvent: MaterializedSyncableEvent;
  name: string;
  settle: SettleForm;
}

/* Google hands descriptions back HTML-escaped, so the form it keeps is longer than what we wrote. */
const escapeForGoogle = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/* Graph keeps a body as HTML, so the form it keeps wraps what we wrote rather than trimming it. */
const wrapAsOutlookBody = (value: string): string => `<html><body>${value}</body></html>`;

/* An iCalendar TEXT value escapes commas, and a server that stores the escape hands it back. */
const escapeForICalendar = (value: string): string => value.replaceAll(",", String.raw`\,`);

/*
 * Each shape rewrites once, in the field that destination is known to rewrite, and then holds.
 * None of the rewritten forms is a prefix of what we wrote.
 */
const DESTINATION_SHAPES: DestinationShape[] = [
  {
    captureChannel: "echo",
    localEvent: localEventWith({
      description: "Budget & headcount <final>",
      location: "Meeting room",
      summary: "Weekly planning",
    }),
    name: "google, escaping the description it kept",
    settle: (stored) => ({ ...stored, description: escapeForGoogle(stored.description) }),
  },
  {
    captureChannel: "echo",
    localEvent: localEventWith({
      description: "Agenda attached",
      location: "Meeting room",
      summary: "Weekly planning",
    }),
    name: "outlook, keeping the description as html",
    settle: (stored) => ({ ...stored, description: wrapAsOutlookBody(stored.description) }),
  },
  {
    captureChannel: "read-back",
    localEvent: localEventWith({
      description: "Agenda attached",
      location: "Room 1, Building 2",
      summary: "Weekly planning",
    }),
    name: "caldav, escaping the location it kept",
    settle: (stored) => ({ ...stored, location: escapeForICalendar(stored.location) }),
  },
];

describe.each(DESTINATION_SHAPES)(
  "a stored form the destination rewrites and then holds ($name)",
  ({ captureChannel, localEvent, settle }) => {
    it("stops writing within a bounded number of passes", async () => {
      const destination = new RewritingDestination(captureChannel, settle);
      const provider = buildProvider(destination, captureChannel);
      const mappingStore = new MappingStore();

      const writesByPass: number[] = [];
      for (let pass = 0; pass < TOTAL_PASSES; pass += 1) {
        destination.resetCalls();
        await reconcile(destination, provider, mappingStore, localEvent);
        writesByPass.push(destination.pushedEventIds.length + destination.deletedIds.length);
      }

      expect(writesByPass.slice(SETTLING_PASS_BUDGET)).toEqual(
        Array.from({ length: TOTAL_PASSES - SETTLING_PASS_BUDGET }, () => 0),
      );

      const settled = destination.snapshot();
      expect(settled).toHaveLength(1);
    });
  },
);

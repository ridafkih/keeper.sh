import { describe, expect, it } from "vitest";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent, RemoteEvent, RemoteEventListing } from "../../../../src/core/types";
import type { EventMapping } from "../../../../src/index";
import type { PendingChanges } from "../../../../src/core/sync-engine/types";
import { parseEventTime as parseOutlookEventTime } from "../../../../src/providers/outlook/shared/date-time";
import { normalizeOutlookEvent } from "../../../../src/providers/outlook/destination/normalize-event";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";

const buildEvent = (overrides: Partial<MaterializedSyncableEvent>): MaterializedSyncableEvent =>
  ({
    availability: "busy",
    calendarId: "calendar-id",
    calendarName: "Calendar",
    calendarUrl: null,
    endTime: new Date("2027-03-08T16:00:00.000Z"),
    id: "event-id",
    location: null,
    sourceEventUid: "source-uid",
    startTime: new Date("2027-03-08T16:00:00.000Z"),
    startTimeZone: "UTC",
    summary: "Point in time",
    ...overrides,
  }) as MaterializedSyncableEvent;

const toInstant = (value: OutlookEvent["start"]): number =>
  new Date(`${value?.dateTime ?? ""}Z`).getTime();

describe("outlook destination representation of an inverted timed range", () => {
  it("never serializes an end that precedes the start", () => {
    const payload = serializeOutlookEvent(normalizeOutlookEvent(buildEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    })));

    expect(toInstant(payload.end)).toBeGreaterThanOrEqual(toInstant(payload.start));
  });

  it("keeps the start the source states for an inverted timed range", () => {
    const normalized = normalizeOutlookEvent(buildEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    }));

    expect(normalized.startTime).toEqual(new Date("2027-03-08T16:00:00.000Z"));
  });

  it("converges across repeated runs against a graph that refuses the range", async () => {
    const { syncCalendar } = await import("../../../../src/core/sync-engine/index");
    const { createEditableEventContentHash } = await import(
      "../../../../src/core/events/content-hash"
    );
    const stored = new Map<string, OutlookEvent & { iCalUId: string; id: string }>();
    const mappings: EventMapping[] = [];
    const attempts: string[] = [];
    const deletes: string[] = [];

    const listRemoteEvents = (): Promise<RemoteEventListing> => {
      const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
        const startTime = parseOutlookEventTime(event.start, event.isAllDay);
        const endTime = parseOutlookEventTime(event.end, event.isAllDay);
        if (!startTime || !endTime) {
          return [];
        }
        return [{
          deleteId: event.id,
          editableAvailability: "busy",
          editableContentHash: createEditableEventContentHash({
            availability: "busy",
            description: event.body?.content,
            endTime,
            isAllDay: event.isAllDay,
            location: event.location?.displayName,
            startTime,
            summary: event.subject ?? "",
          }),
          endTime,
          isKeeperEvent: true,
          startTime,
          supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
          uid: event.iCalUId,
        }];
      });
      return Promise.resolve({ items, rawItemCount: items.length });
    };

    const runSync = () => syncCalendar({
      calendarId: "destination-calendar",
      flush: (changes: PendingChanges) => {
        for (const insert of changes.inserts) {
          mappings.push({ ...insert, id: `mapping-${mappings.length}` } as EventMapping);
        }
        for (const deleted of changes.deletes) {
          const index = mappings.findIndex((mapping) => mapping.id === deleted);
          if (index !== -1) {
            mappings.splice(index, 1);
          }
        }
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider: {
        deleteEvents: (eventIds) => Promise.resolve(eventIds.map((eventId) => {
          deletes.push(eventId);
          stored.delete(eventId);
          return { success: true };
        })),
        listRemoteEvents,
        normalizeEvent: normalizeOutlookEvent,
        pushEvents: (events) => Promise.resolve(events.map((event) => {
          const payload = serializeOutlookEvent(event);
          if (toInstant(payload.end) < toInstant(payload.start)) {
            attempts.push("The end date must be after the start date.");
            return { error: "The end date must be after the start date.", success: false as const };
          }
          const uid = `keeper-${event.id}`;
          stored.set(event.id, { ...payload, iCalUId: uid, id: event.id });
          return { deleteId: event.id, remoteId: uid, success: true as const };
        })),
      },
      readState: async () => {
        const listing = await listRemoteEvents();
        return {
          existingMappings: [...mappings],
          localEvents: [buildEvent({
            endTime: new Date("2027-03-08T15:00:00.000Z"),
            startTime: new Date("2027-03-08T16:00:00.000Z"),
          })],
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: {
        authoritativeWindow: {
          timeMax: new Date("2100-01-01T00:00:00.000Z"),
          timeMin: new Date("2000-01-01T00:00:00.000Z"),
        },
        requestedWindow: {
          timeMax: new Date("2100-01-01T00:00:00.000Z"),
          timeMin: new Date("2000-01-01T00:00:00.000Z"),
        },
      },
      userId: "user-1",
    });

    const first = await runSync();
    const second = await runSync();
    const third = await runSync();

    expect(attempts).toEqual([]);
    expect(first).toMatchObject({ added: 1, addFailed: 0 });
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, addFailed: 0, removed: 0 });
    expect(deletes).toEqual([]);
    expect(stored.size).toBe(1);
  });

  it("never serializes an end that precedes the start for an inverted all-day range", () => {
    const payload = serializeOutlookEvent(normalizeOutlookEvent(buildEvent({
      endTime: new Date("2027-03-05T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-10T00:00:00.000Z"),
    })));

    expect(toInstant(payload.end)).toBeGreaterThanOrEqual(toInstant(payload.start));
  });
});

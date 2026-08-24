import { describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { SourceEvent } from "../../../src/core/types";

const START_TIME = new Date("2026-06-20T09:00:00.000Z");
const END_TIME = new Date("2026-06-20T10:00:00.000Z");

const sourceEvent = (uid: string): SourceEvent => ({
  endTime: END_TIME,
  startTime: START_TIME,
  title: `Event ${uid}`,
  uid,
});

const storedEvent = (uid: string) => ({
  availability: null,
  description: null,
  endTime: END_TIME,
  exceptionDates: null,
  id: `state-${uid}`,
  isAllDay: null,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventId: null,
  sourceEventType: null,
  sourceEventUid: uid,
  startTime: START_TIME,
  startTimeZone: null,
  title: `Event ${uid}`,
});

const STORED_UIDS = ["a@example.com", "b@example.com", "c@example.com"];

const createPersistence = () => {
  const flush = vi.fn<(changes: IngestionChanges) => Promise<void>>(() => Promise.resolve());
  return {
    flush,
    readExistingEvents: () => Promise.resolve(STORED_UIDS.map((uid) => storedEvent(uid))),
  };
};

describe("ingestSource when a source fetch is incomplete", () => {
  it("does not delete stored source events when the fetch throws", async () => {
    const persistence = createPersistence();

    await expect(ingestSource({
      calendarId: "calendar-1",
      fetchEvents: () => Promise.reject(new Error("CalDAV multiget returned 1 of 3 requested objects")),
      ...persistence,
    })).rejects.toThrow("CalDAV multiget returned 1 of 3 requested objects");

    expect(persistence.flush).not.toHaveBeenCalled();
  });

  /*
   * Characterization test, not a defect. This is the executable reason
   * CalDAVClient.fetchCalendarObjects must throw on a short multiget rather
   * than degrade to a partial set: every event whose object went missing is
   * deleted here and the deletion propagates to mapped destinations.
   */
  it("deletes every stored source event when a fetch silently returns a subset", async () => {
    const persistence = createPersistence();

    await ingestSource({
      calendarId: "calendar-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent(STORED_UIDS[0] ?? "")] }),
      ...persistence,
    });

    expect(persistence.flush).toHaveBeenCalledTimes(1);
    const changes = persistence.flush.mock.calls[0]?.[0];
    expect(changes?.deletes).toHaveLength(2);
    expect(changes?.deletes).toEqual(
      expect.arrayContaining(["state-b@example.com", "state-c@example.com"]),
    );
  });
});

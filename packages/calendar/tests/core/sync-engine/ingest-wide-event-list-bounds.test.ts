import { describe, expect, it } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type {
  FetchEventsResult,
  IngestWideEventFields,
} from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";

const START_TIME = new Date("2026-06-20T09:00:00.000Z");
const END_TIME = new Date("2026-06-20T10:00:00.000Z");

const sourceEvent = (uid: string): SourceEvent => ({
  endTime: END_TIME,
  startTime: START_TIME,
  title: `Event ${uid}`,
  uid,
});

const storedEvent = (uid: string): StoredSourceEventState => ({
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

const runIngest = async (
  fetchResult: FetchEventsResult,
  stored: StoredSourceEventState[] = [],
): Promise<IngestWideEventFields> => {
  let wideEvent: IngestWideEventFields = {};
  await ingestSource({
    calendarId: "calendar-1",
    fetchEvents: () => Promise.resolve(fetchResult),
    flush: () => Promise.resolve(),
    onIngestEvent: (event) => {
      wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve(stored),
  });
  return wideEvent;
};

const uids = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => `uid-${String(index).padStart(3, "0")}@example.com`);

describe("ingest wide-event identifier lists", () => {
  it("emits only loggable scalar values, never an object or undefined", async () => {
    const wideEvent = await runIngest({
      discardedEventCounts: { outsideSyncWindow: 1, unrepresentable: 2 },
      events: uids(3).map((uid) => sourceEvent(uid)),
      selfAuthoredEventCount: 4,
      skippedResourceCount: 2,
      skippedResourceReasons: ["/cal/a.ics: unreadable", "/cal/b.ics: unreadable"],
      unsupportedEventUids: uids(3),
    });

    for (const [key, value] of Object.entries(wideEvent)) {
      expect(
        ["boolean", "number", "string"].includes(typeof value),
        `${key} must be a loggable scalar, got ${typeof value}`,
      ).toBe(true);
    }
  });

  it("keeps the whole list when it sits exactly on the sample limit", async () => {
    const wideEvent = await runIngest({
      events: uids(20).map((uid) => sourceEvent(uid)),
      unsupportedEventUids: uids(20),
    });

    expect(wideEvent["source_events.unsupported_count"]).toBe(20);
    expect(String(wideEvent["source_events.unsupported_uids"])).not.toContain("more)");
    expect(String(wideEvent["source_events.unsupported_uids"]).split(",")).toHaveLength(20);
  });

  it("reports the omitted remainder once the list passes the sample limit", async () => {
    const wideEvent = await runIngest({
      events: uids(21).map((uid) => sourceEvent(uid)),
      unsupportedEventUids: uids(21),
    });

    expect(wideEvent["source_events.unsupported_count"]).toBe(21);
    expect(String(wideEvent["source_events.unsupported_uids"])).toContain("(+1 more)");
  });

  it("counts unsupported uids once when the provider repeats them", async () => {
    const repeated = ["dup@example.com", "dup@example.com", "other@example.com"];
    const wideEvent = await runIngest({
      events: [sourceEvent("dup@example.com"), sourceEvent("other@example.com")],
      unsupportedEventUids: repeated,
    });

    expect(wideEvent["source_events.unsupported_count"]).toBe(2);
  });

  it("bounds a single pathologically long identifier", async () => {
    const longUid = `${"x".repeat(9000)}@example.com`;
    const wideEvent = await runIngest({
      events: [sourceEvent(longUid)],
      unsupportedEventUids: [longUid],
    });

    const value = String(wideEvent["source_events.unsupported_uids"]);
    expect(value.length).toBeLessThan(2200);
    expect(value).toContain("(truncated)");
  });

  it("still emits a loggable reason field when the provider gave no reasons", async () => {
    const wideEvent = await runIngest({
      events: [],
      skippedResourceCount: 3,
    }, [storedEvent("gone@example.com")]);

    expect(wideEvent["source_events.skipped_resources"]).toBe(3);
    expect(typeof wideEvent["source_events.skipped_resource_reasons"]).toBe("string");
    expect(wideEvent["events.removed"]).toBe(1);
  });

  it("omits the discard counters entirely rather than emitting undefined", async () => {
    const wideEvent = await runIngest({ events: [] });

    expect(Object.hasOwn(wideEvent, "source_events.discarded_unrepresentable")).toBe(false);
    expect(Object.hasOwn(wideEvent, "source_events.skipped_self_authored")).toBe(false);
    expect(wideEvent["source_events.count"]).toBe(0);
  });
});

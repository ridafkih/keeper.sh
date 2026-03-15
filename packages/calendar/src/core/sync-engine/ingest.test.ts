import { describe, expect, it } from "bun:test";
import type { SourceEvent } from "../types";

const makeSourceEvent = (uid: string, startTime: Date, endTime: Date): SourceEvent => ({
  uid,
  startTime,
  endTime,
  title: `Event ${uid}`,
});

interface ExistingEvent {
  id: string;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}

describe("ingestSource", () => {
  it("accumulates event inserts from new source events and flushes at the end", async () => {
    const { ingestSource } = await import("./ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const flushCapture: { inserts: unknown[]; deletes: string[] }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(1);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(1);
  });

  it("accumulates event deletes when source events are removed", async () => {
    const { ingestSource } = await import("./ingest");

    const existingEvent: ExistingEvent = {
      id: "state-1",
      sourceEventUid: "uid-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
      endTime: new Date("2026-03-15T10:00:00Z"),
      availability: null,
      isAllDay: null,
      sourceEventType: null,
    };

    const flushCapture: { inserts: unknown[]; deletes: string[] }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([existingEvent]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(1);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.deletes).toHaveLength(1);
    expect(flushCapture[0]?.deletes[0]).toBe("state-1");
  });

  it("does not flush when there are no changes", async () => {
    const { ingestSource } = await import("./ingest");

    let flushCalled = false;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("includes sync token in flush when provided by fetchEvents", async () => {
    const { ingestSource } = await import("./ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const flushCapture: { syncToken?: string | null }[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent], nextSyncToken: "token-abc" }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(flushCapture[0]?.syncToken).toBe("token-abc");
  });

  it("emits a wide event with ingestion context", async () => {
    const { ingestSource } = await import("./ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const emittedEvents: Record<string, unknown>[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => Promise.resolve(),
      onIngestEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["calendar.id"]).toBe("cal-1");
    expect(emittedEvents[0]?.["events.added"]).toBe(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("success");
    expect(typeof emittedEvents[0]?.["duration_ms"]).toBe("number");
  });

  it("clears sync token and returns empty result when fullSyncRequired is true", async () => {
    const { ingestSource } = await import("./ingest");

    const existingEvent: ExistingEvent = {
      id: "state-1",
      sourceEventUid: "uid-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
      endTime: new Date("2026-03-15T10:00:00Z"),
      availability: null,
      isAllDay: null,
      sourceEventType: null,
    };

    const flushCapture: { inserts: unknown[]; deletes: string[]; syncToken?: string | null }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], fullSyncRequired: true }),
      readExistingEvents: () => Promise.resolve([existingEvent]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(0);
    expect(flushCapture[0]?.deletes).toHaveLength(0);
    expect(flushCapture[0]?.syncToken).toBeNull();
  });

  it("flushes sync token even when delta sync yields no event changes", async () => {
    const { ingestSource } = await import("./ingest");

    const flushCapture: { inserts: unknown[]; deletes: string[]; syncToken?: string | null }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], isDeltaSync: true, nextSyncToken: "token-new" }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(0);
    expect(flushCapture[0]?.deletes).toHaveLength(0);
    expect(flushCapture[0]?.syncToken).toBe("token-new");
  });

  it("does not flush sync token when no changes and no sync token provided", async () => {
    const { ingestSource } = await import("./ingest");

    let flushCalled = false;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("emits wide event with flushed: false in error path", async () => {
    const { ingestSource } = await import("./ingest");

    const emittedEvents: Record<string, unknown>[] = [];

    try {
      await ingestSource({
        calendarId: "cal-1",
        fetchEvents: () => Promise.reject(new Error("fetch failed")),
        readExistingEvents: () => Promise.resolve([]),
        flush: () => Promise.resolve(),
        onIngestEvent: (event) => { emittedEvents.push(event); },
      });
    } catch {
      // Expected to throw
    }

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("error");
    expect(emittedEvents[0]?.["flushed"]).toBe(false);
    expect(emittedEvents[0]?.["error.message"]).toBe("fetch failed");
  });
});

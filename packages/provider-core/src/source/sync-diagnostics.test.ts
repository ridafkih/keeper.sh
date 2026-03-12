import { describe, expect, it } from "bun:test";
import type { SourceEvent } from "../types";
import type { ExistingSourceEventState } from "./event-diff";
import {
  filterSourceEventsToSyncWindow,
  resolveSourceSyncTokenAction,
  splitSourceEventsByStorageIdentity,
} from "./sync-diagnostics";

const createSourceEvent = (overrides: Partial<SourceEvent>): SourceEvent => ({
  endTime: new Date("2026-03-12T11:00:00.000Z"),
  startTime: new Date("2026-03-12T10:00:00.000Z"),
  uid: "event-1",
  ...overrides,
});

const createExistingEvent = (
  overrides: Partial<ExistingSourceEventState>,
): ExistingSourceEventState => ({
  endTime: new Date("2026-03-12T11:00:00.000Z"),
  id: "existing-1",
  sourceEventType: "default",
  sourceEventUid: "event-1",
  startTime: new Date("2026-03-12T10:00:00.000Z"),
  ...overrides,
});

describe("filterSourceEventsToSyncWindow", () => {
  it("drops events fully outside the sync window", () => {
    const events = [
      createSourceEvent({
        endTime: new Date("2026-03-01T11:00:00.000Z"),
        startTime: new Date("2026-03-01T10:00:00.000Z"),
        uid: "old",
      }),
      createSourceEvent({
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        uid: "inside",
      }),
      createSourceEvent({
        endTime: new Date("2026-05-01T11:00:00.000Z"),
        startTime: new Date("2026-05-01T10:00:00.000Z"),
        uid: "future",
      }),
    ];

    const result = filterSourceEventsToSyncWindow(events, {
      timeMax: new Date("2026-03-31T23:59:59.999Z"),
      timeMin: new Date("2026-03-10T00:00:00.000Z"),
    });

    expect(result.filteredCount).toBe(2);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe("inside");
  });
});

describe("splitSourceEventsByStorageIdentity", () => {
  it("separates true inserts from upserts on existing storage identity", () => {
    const existingEvents = [
      createExistingEvent({
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        sourceEventUid: "event-1",
        startTime: new Date("2026-03-12T10:00:00.000Z"),
      }),
    ];

    const eventsToAdd = [
      createSourceEvent({
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        uid: "event-1",
      }),
      createSourceEvent({
        endTime: new Date("2026-03-13T11:00:00.000Z"),
        startTime: new Date("2026-03-13T10:00:00.000Z"),
        uid: "event-2",
      }),
    ];

    const result = splitSourceEventsByStorageIdentity(existingEvents, eventsToAdd);

    expect(result.eventsToInsert).toHaveLength(1);
    expect(result.eventsToInsert[0]?.uid).toBe("event-2");
    expect(result.eventsToUpdate).toHaveLength(1);
    expect(result.eventsToUpdate[0]?.uid).toBe("event-1");
  });
});

describe("resolveSourceSyncTokenAction", () => {
  it("requests token reset when delta sync returns no next token", () => {
    const tokenPayload: { nextSyncToken?: string } = {};
    const result = resolveSourceSyncTokenAction(tokenPayload.nextSyncToken, true);
    expect(result.shouldResetSyncToken).toBe(true);
    expect(result.nextSyncTokenToPersist).toBeUndefined();
  });

  it("persists next token when available", () => {
    const result = resolveSourceSyncTokenAction("next-token", true);
    expect(result.shouldResetSyncToken).toBe(false);
    expect(result.nextSyncTokenToPersist).toBe("next-token");
  });
});

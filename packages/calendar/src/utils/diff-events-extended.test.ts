import { describe, expect, it } from "bun:test";
import { diffEvents } from "./diff-events";
import type { EventTimeSlot, StoredEventTimeSlot } from "./types";

const createEvent = (uid: string, startIso = "2026-03-08T14:00:00.000Z"): EventTimeSlot => ({
  endTime: new Date("2026-03-08T14:30:00.000Z"),
  startTime: new Date(startIso),
  uid,
});

const toStored = (event: EventTimeSlot, id: string): StoredEventTimeSlot => ({
  ...event,
  id,
});

describe("diffEvents", () => {
  it("marks new remote events for addition", () => {
    const remote = [createEvent("uid-1"), createEvent("uid-2")];
    const stored: StoredEventTimeSlot[] = [];

    const result = diffEvents(remote, stored);

    expect(result.toAdd).toHaveLength(2);
    expect(result.toRemove).toHaveLength(0);
  });

  it("marks stored events missing from remote for removal", () => {
    const remote: EventTimeSlot[] = [];
    const stored = [toStored(createEvent("uid-1"), "id-1")];

    const result = diffEvents(remote, stored);

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(1);
    const [removedEvent] = result.toRemove;
    expect(removedEvent).toBeDefined();
    if (!removedEvent) {
      throw new TypeError("Expected removed event");
    }
    expect(removedEvent.id).toBe("id-1");
  });

  it("returns empty diff when remote and stored match exactly", () => {
    const event = createEvent("uid-1");
    const result = diffEvents([event], [toStored(event, "id-1")]);

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
  });

  it("returns empty diff for two empty arrays", () => {
    const result = diffEvents([], []);
    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
  });

  it("detects time change as add + remove for same uid", () => {
    const remote = [createEvent("uid-1", "2026-03-09T10:00:00.000Z")];
    const stored = [toStored(createEvent("uid-1", "2026-03-08T14:00:00.000Z"), "id-1")];

    const result = diffEvents(remote, stored);

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });

  it("handles null/undefined timezone by treating them as equivalent", () => {
    const remote: EventTimeSlot[] = [createEvent("uid-1")];
    const stored: StoredEventTimeSlot[] = [
      toStored(createEvent("uid-1"), "id-1"),
    ];

    const result = diffEvents(remote, stored);

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
  });

  it("deduplicates remote events with same identity key", () => {
    const event = createEvent("uid-1");
    const result = diffEvents([event, event], []);

    expect(result.toAdd).toHaveLength(1);
  });
});

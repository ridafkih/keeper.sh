import { describe, expect, it } from "vitest";
import {
  requireMappingSourceCalendarId,
  requireMappingSyncEventId,
} from "../../../src/core/events/mappings";

describe("mapping sync identity", () => {
  it("returns a persisted identity without falling back to the event state", () => {
    expect(requireMappingSyncEventId({
      eventStateId: "event-state-1",
      id: "mapping-1",
      syncEventId: "sync-event-1",
    })).toBe("sync-event-1");
  });

  it("supports an old writer until the compatibility trigger backfills the identity", () => {
    expect(requireMappingSyncEventId({
      eventStateId: "event-state-1",
      id: "mapping-1",
      syncEventId: null,
    })).toBe("event-state-1");
  });

  it("rejects an unresolved legacy mapping", () => {
    expect(() => requireMappingSyncEventId({
      eventStateId: null,
      id: "mapping-1",
      syncEventId: null,
    })).toThrow("Event mapping mapping-1 has no sync identity");
  });
});

describe("mapping source identity", () => {
  it("returns the persisted source calendar identity", () => {
    expect(requireMappingSourceCalendarId({
      eventStateId: "event-state-1",
      eventStateCalendarId: "event-state-calendar",
      id: "mapping-1",
      sourceCalendarId: "source-calendar",
    })).toBe("source-calendar");
  });

  it("supports an old writer through its linked event state", () => {
    expect(requireMappingSourceCalendarId({
      eventStateId: "event-state-1",
      eventStateCalendarId: "event-state-calendar",
      id: "mapping-1",
      sourceCalendarId: null,
    })).toBe("event-state-calendar");
  });

  it("retains an unresolved source identity for a deletion tombstone", () => {
    expect(requireMappingSourceCalendarId({
      eventStateId: null,
      eventStateCalendarId: null,
      id: "mapping-1",
      sourceCalendarId: null,
    })).toBeNull();
  });

  it("rejects a live mapping with no source identity", () => {
    expect(() => requireMappingSourceCalendarId({
      eventStateId: "event-state-1",
      eventStateCalendarId: null,
      id: "mapping-1",
      sourceCalendarId: null,
    })).toThrow("Event mapping mapping-1 has no source calendar identity");
  });
});

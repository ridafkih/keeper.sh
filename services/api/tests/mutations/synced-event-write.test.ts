import { describe, expect, it } from "vitest";
import { resolveSyncedEventWriteError } from "../../src/mutations/synced-event-write";

const writable = {
  isRecurring: false,
  occurrenceStart: null,
  sourceEventUid: "abc123@google.com",
};

describe("resolveSyncedEventWriteError", () => {
  it("allows a non-recurring event from a connected calendar", () => {
    expect(resolveSyncedEventWriteError(writable)).toBeNull();
  });

  it("refuses a recurring series", () => {
    expect(resolveSyncedEventWriteError({ ...writable, isRecurring: true })).toMatch(/Recurring/);
  });

  it("refuses a single occurrence of a recurring series", () => {
    expect(
      resolveSyncedEventWriteError({ ...writable, occurrenceStart: new Date("2026-09-24T15:00:00Z") }),
    ).toMatch(/Recurring/);
  });

  it("refuses an event without a source UID", () => {
    expect(resolveSyncedEventWriteError({ ...writable, sourceEventUid: null })).toMatch(/no source UID/);
  });

  it("refuses a copy Keeper.sh pushed into the calendar", () => {
    expect(
      resolveSyncedEventWriteError({ ...writable, sourceEventUid: "0f3c9a@keeper.sh" }),
    ).toMatch(/copy kept in sync by Keeper\.sh/);
  });
});

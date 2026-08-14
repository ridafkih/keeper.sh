import { describe, expect, it } from "vitest";
import { isCalendarId, setCalendarPaused } from "../../src/utils/calendar-pause";
import type { KeeperDatabase } from "../../src/types";

const CALENDAR_ID = "019c0000-0000-7000-8000-000000000001";

interface UpdatedRow {
  id: string;
  disabled: boolean;
}

const createMockDatabase = (rows: UpdatedRow[]) => {
  const state = { updates: [] as Record<string, unknown>[] };

  const database = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve(rows),
          }),
        };
      },
    }),
  } as unknown as KeeperDatabase;

  return { database, state };
};

describe("isCalendarId", () => {
  it("accepts a UUID", () => {
    expect(isCalendarId(CALENDAR_ID)).toBe(true);
  });

  it("rejects a non-UUID", () => {
    expect(isCalendarId("free-time")).toBe(false);
  });

  it("rejects an empty route parameter", () => {
    expect(isCalendarId("")).toBe(false);
  });
});

describe("setCalendarPaused", () => {
  it("pauses a calendar by disabling it", async () => {
    const { database, state } = createMockDatabase([{ disabled: true, id: CALENDAR_ID }]);

    const result = await setCalendarPaused(database, "user-1", CALENDAR_ID, true);

    expect(state.updates).toEqual([{ disabled: true }]);
    expect(result).toEqual({ calendarId: CALENDAR_ID, paused: true });
  });

  it("resumes a calendar by re-enabling it", async () => {
    const { database, state } = createMockDatabase([{ disabled: false, id: CALENDAR_ID }]);

    const result = await setCalendarPaused(database, "user-1", CALENDAR_ID, false);

    expect(state.updates).toEqual([{
      disabled: false,
      failureCount: 0,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
      lastFailureAt: null,
      nextAttemptAt: null,
    }]);
    expect(result).toEqual({ calendarId: CALENDAR_ID, paused: false });
  });

  it("returns null when the calendar does not belong to the user", async () => {
    const { database } = createMockDatabase([]);

    const result = await setCalendarPaused(database, "user-1", CALENDAR_ID, true);

    expect(result).toBeNull();
  });
});

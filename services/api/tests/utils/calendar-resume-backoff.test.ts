import { describe, expect, it } from "vitest";
import { setCalendarPaused } from "../../src/utils/calendar-pause";
import { RECONNECTED_CALENDAR_STATE } from "../../src/utils/calendar-state";
import type { KeeperDatabase } from "../../src/types";

const CALENDAR_ID = "019c0000-0000-7000-8000-000000000042";
const USER_ID = "019c0000-0000-7000-8000-0000000000ff";

const createRecordingDatabase = (disabled: boolean) => {
  const updates: Record<string, unknown>[] = [];

  const database = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ disabled, id: CALENDAR_ID }]),
          }),
        };
      },
    }),
  } as unknown as KeeperDatabase;

  return { database, updates };
};

describe("resuming a source that was paused while its ingest backoff was armed", () => {
  it("clears the ingest backoff so the source is polled on the next tick", async () => {
    const { database, updates } = createRecordingDatabase(false);

    await setCalendarPaused(database, USER_ID, CALENDAR_ID, false);

    expect(updates[0]).toMatchObject({
      disabled: false,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("leaves the backoff alone when the calendar is being paused rather than resumed", async () => {
    const { database, updates } = createRecordingDatabase(true);

    await setCalendarPaused(database, USER_ID, CALENDAR_ID, true);

    expect(updates[0]).toEqual({ disabled: true });
  });
});

describe("the re-enable path the unpause route uses", () => {
  it("clears the ingest backoff in the same write that re-enables the calendar", () => {
    expect(RECONNECTED_CALENDAR_STATE).toMatchObject({
      disabled: false,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });
});

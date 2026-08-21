import { describe, expect, it, vi } from "vitest";
import { runDeleteSourceCalendar } from "../../src/utils/delete-source-calendar";

const CALENDAR_ID = "calendar-1";
const USER_ID = "user-1";

const makeDependencies = (capabilities: string[]) => {
  const deleteCalendarRow = vi.fn(() => Promise.resolve(true));
  const deregisterPushChannels = vi.fn(() => Promise.resolve(0));
  const loadCapabilities = vi.fn(() => Promise.resolve(capabilities));
  const isOwnedByUser = vi.fn(() => Promise.resolve(true));
  const recordError = vi.fn();

  return {
    deleteCalendarRow,
    deregisterPushChannels,
    isOwnedByUser,
    loadCapabilities,
    recordError,
  };
};

describe("runDeleteSourceCalendar capability guard", () => {
  it("refuses to delete a calendar keeper pushes events to", async () => {
    const dependencies = makeDependencies(["pull", "push"]);

    await expect(
      runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies),
    ).resolves.toBe(false);

    expect(dependencies.deleteCalendarRow).not.toHaveBeenCalled();
  });

  it("leaves the provider subscription in place when it refuses a push-capable calendar", async () => {
    const dependencies = makeDependencies(["pull", "push"]);

    await runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies);

    expect(dependencies.deregisterPushChannels).not.toHaveBeenCalled();
  });

  it("still deletes a calendar keeper only pulls from", async () => {
    const dependencies = makeDependencies(["pull"]);

    await expect(
      runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies),
    ).resolves.toBe(true);

    expect(dependencies.deleteCalendarRow).toHaveBeenCalledTimes(1);
    expect(dependencies.deregisterPushChannels).toHaveBeenCalledWith(CALENDAR_ID);
  });
});

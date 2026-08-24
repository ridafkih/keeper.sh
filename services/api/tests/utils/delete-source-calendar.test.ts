import { describe, expect, it, vi } from "vitest";

const CHANNEL_ID = "provider-channel-1";
const CALENDAR_ID = "calendar-1";
const USER_ID = "user-1";

interface FakeChannel {
  calendarId: string;
  providerChannelId: string;
}

const loadRunner = async () => {
  const module = await import("../../src/utils/delete-source-calendar");
  return module.runDeleteSourceCalendar;
};

const makeFakeRegistrar = (channels: FakeChannel[]) => {
  const deregistered: string[] = [];
  return {
    deregistered,
    deregisterForCalendar: (calendarId: string) => {
      for (const channel of channels) {
        if (channel.calendarId === calendarId) {
          deregistered.push(channel.providerChannelId);
        }
      }
      return Promise.resolve(deregistered.length);
    },
  };
};

const makeDependencies = () => {
  const callLog: string[] = [];
  const registrar = makeFakeRegistrar([
    { calendarId: CALENDAR_ID, providerChannelId: CHANNEL_ID },
  ]);

  return {
    callLog,
    dependencies: {
      deleteCalendarRow: vi.fn(() => {
        callLog.push("deleteCalendarRow");
        return Promise.resolve(true);
      }),
      deregisterPushChannels: vi.fn((calendarId: string) => {
        callLog.push("deregisterPushChannels");
        return registrar.deregisterForCalendar(calendarId);
      }),
      isOwnedByUser: vi.fn(() => {
        callLog.push("isOwnedByUser");
        return Promise.resolve(true);
      }),
      loadCapabilities: vi.fn(() => Promise.resolve(["pull"])),
      recordError: vi.fn(),
    },
    registrar,
  };
};

describe("runDeleteSourceCalendar", () => {
  it("deregisters the calendar's push channel at the provider before the row is deleted", async () => {
    const runDeleteSourceCalendar = await loadRunner();
    const { callLog, dependencies, registrar } = makeDependencies();

    await expect(
      runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies),
    ).resolves.toBe(true);

    expect(registrar.deregistered).toEqual([CHANNEL_ID]);
    expect(callLog).toEqual([
      "isOwnedByUser",
      "deregisterPushChannels",
      "deleteCalendarRow",
    ]);
    expect(dependencies.deregisterPushChannels).toHaveBeenCalledWith(CALENDAR_ID);
  });

  it("deletes the row even when the provider deregistration fails", async () => {
    const runDeleteSourceCalendar = await loadRunner();
    const { callLog, dependencies } = makeDependencies();
    dependencies.deregisterPushChannels = vi.fn(() => {
      callLog.push("deregisterPushChannels");
      return Promise.reject(new Error("provider unreachable"));
    });

    await expect(
      runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies),
    ).resolves.toBe(true);

    expect(callLog).toEqual([
      "isOwnedByUser",
      "deregisterPushChannels",
      "deleteCalendarRow",
    ]);
  });

  it("leaves the provider subscription alone for a calendar the caller does not own", async () => {
    const runDeleteSourceCalendar = await loadRunner();
    const { dependencies, registrar } = makeDependencies();
    dependencies.isOwnedByUser = vi.fn(() => Promise.resolve(false));

    await expect(
      runDeleteSourceCalendar({ calendarId: CALENDAR_ID, userId: USER_ID }, dependencies),
    ).resolves.toBe(false);

    expect(registrar.deregistered).toEqual([]);
    expect(dependencies.deleteCalendarRow).not.toHaveBeenCalled();
  });
});

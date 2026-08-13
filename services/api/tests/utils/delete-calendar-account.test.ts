import { describe, expect, it, vi } from "vitest";
import { runDeleteCalendarAccount } from "../../src/utils/delete-calendar-account";

const makeOrderedDependencies = () => {
  const callLog: string[] = [];
  return {
    callLog,
    dependencies: {
      deleteAccountRow: vi.fn(() => {
        callLog.push("deleteAccountRow");
        return Promise.resolve(true);
      }),
      deregisterPushChannels: vi.fn(() => {
        callLog.push("deregisterPushChannels");
        return Promise.resolve(1);
      }),
      isOwnedByUser: vi.fn(() => {
        callLog.push("isOwnedByUser");
        return Promise.resolve(true);
      }),
      recordError: vi.fn(),
      scheduleReplacementSync: vi.fn(() => {
        callLog.push("scheduleReplacementSync");
      }),
    },
  };
};

describe("runDeleteCalendarAccount", () => {
  it("stops the account's push channels before the row that owns its credentials is deleted", async () => {
    const { callLog, dependencies } = makeOrderedDependencies();

    await expect(
      runDeleteCalendarAccount({ accountId: "account-1", userId: "user-1" }, dependencies),
    ).resolves.toBe(true);

    expect(callLog).toEqual([
      "isOwnedByUser",
      "deregisterPushChannels",
      "deleteAccountRow",
      "scheduleReplacementSync",
    ]);
    expect(dependencies.deregisterPushChannels).toHaveBeenCalledWith("account-1");
  });

  it("does not touch push channels for an account the caller does not own", async () => {
    const { dependencies } = makeOrderedDependencies();
    dependencies.isOwnedByUser = vi.fn(() => Promise.resolve(false));

    await expect(
      runDeleteCalendarAccount({ accountId: "account-1", userId: "user-1" }, dependencies),
    ).resolves.toBe(false);

    expect(dependencies.deregisterPushChannels).not.toHaveBeenCalled();
    expect(dependencies.deleteAccountRow).not.toHaveBeenCalled();
  });

  it("proceeds with the disconnect when deregistration cannot be completed", async () => {
    const { callLog, dependencies } = makeOrderedDependencies();
    dependencies.deregisterPushChannels = vi.fn(() => {
      callLog.push("deregisterPushChannels");
      return Promise.reject(new Error("provider unreachable"));
    });

    await expect(
      runDeleteCalendarAccount({ accountId: "account-1", userId: "user-1" }, dependencies),
    ).resolves.toBe(true);

    expect(callLog).toEqual([
      "isOwnedByUser",
      "deregisterPushChannels",
      "deleteAccountRow",
      "scheduleReplacementSync",
    ]);
    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe("webhook-deregistration-failed");
  });

  it("skips the replacement sync when no row was deleted", async () => {
    const { dependencies } = makeOrderedDependencies();
    dependencies.deleteAccountRow = vi.fn(() => Promise.resolve(false));

    await expect(
      runDeleteCalendarAccount({ accountId: "account-1", userId: "user-1" }, dependencies),
    ).resolves.toBe(false);

    expect(dependencies.scheduleReplacementSync).not.toHaveBeenCalled();
  });
});

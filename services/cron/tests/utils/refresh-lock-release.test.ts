import { describe, expect, it, vi } from "vitest";

const errorFields = vi.fn();

vi.mock("@/utils/logging", () => ({
  widelog: { errorFields, set: vi.fn() },
    count: () => null,
    max: () => null,
    min: () => null,
}));

const { releaseRefreshLock } = await import("../../src/utils/refresh-lock-release");

describe("releasing the calendar rediscovery lock", () => {
  it("does not turn a completed rediscovery into a job failure when the release fails", async () => {
    const store = {
      release: () => Promise.reject(new Error("Redis connection lost")),
    };

    await expect(
      releaseRefreshLock(store, "calendar-rediscover:account-1"),
    ).resolves.toBeUndefined();
  });

  it("reports the release failure instead of swallowing it", async () => {
    errorFields.mockClear();
    const failure = new Error("Redis connection lost");
    const store = { release: () => Promise.reject(failure) };

    await releaseRefreshLock(store, "calendar-rediscover:account-1");

    expect(errorFields).toHaveBeenCalledWith(failure, {
      slug: "refresh-lock-release-failed",
      retriable: true,
    });
  });

  it("releases the lock on the happy path", async () => {
    const released: string[] = [];
    const store = {
      release: (key: string) => {
        released.push(key);
        return Promise.resolve();
      },
    };

    await releaseRefreshLock(store, "calendar-rediscover:account-1");

    expect(released).toEqual(["calendar-rediscover:account-1"]);
  });
});

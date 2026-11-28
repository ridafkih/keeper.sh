import { describe, expect, it, vi } from "vitest";
import type { RedisRateLimiter, SyncProgressUpdate } from "@keeper.sh/calendar";
import { resolvePushRequestsPerMinute, withPlannedPushWrites } from "../src/push-write-plan";

const processingUpdate = (current: number, total: number): SyncProgressUpdate => ({
  calendarId: "calendar-1",
  inSync: false,
  localEventCount: 0,
  progress: { current, total },
  remoteEventCount: 0,
  stage: "processing",
  status: "syncing",
  userId: "user-1",
});

describe("the planned push writes of a destination run", () => {
  it("announces the pending operations and the limiter's pace once, before writing starts", () => {
    const onWritesPlanned = vi.fn();
    const onProgress = vi.fn();
    const listener = withPlannedPushWrites(240, onWritesPlanned, onProgress);

    const { progress: _progress, ...comparingUpdate } = processingUpdate(0, 0);
    listener({ ...comparingUpdate, stage: "comparing" });
    listener(processingUpdate(0, 1200));
    listener(processingUpdate(100, 1200));

    expect(onWritesPlanned).toHaveBeenCalledOnce();
    expect(onWritesPlanned).toHaveBeenCalledWith({
      calendarId: "calendar-1",
      operationCount: 1200,
      requestsPerMinute: 240,
    });
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("reads the pace from the limiter and reports none when it cannot tell", async () => {
    const pacedLimiter: RedisRateLimiter = {
      acquire: () => Promise.resolve(),
      currentRequestsPerMinute: () => Promise.resolve(120),
    };
    const unpacedLimiter: RedisRateLimiter = { acquire: () => Promise.resolve() };

    await expect(resolvePushRequestsPerMinute(pacedLimiter)).resolves.toBe(120);
    await expect(resolvePushRequestsPerMinute(unpacedLimiter)).resolves.toBeNull();
    await expect(resolvePushRequestsPerMinute(globalThis.undefined)).resolves.toBeNull();
  });
});

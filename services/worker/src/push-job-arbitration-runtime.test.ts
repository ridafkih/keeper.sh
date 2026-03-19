import { describe, expect, it } from "bun:test";
import {
  SUPERSEDED_REASON,
  createPushJobArbitrationRuntime,
} from "./push-job-arbitration-runtime";

describe("push job arbitration runtime", () => {
  it("supersedes active job and ignores stale completion", async () => {
    const cancelled: { jobId: string; reason: string }[] = [];
    const held: string[] = [];
    const released: string[] = [];
    const runtime = createPushJobArbitrationRuntime({
      onRuntimeEvent: () => Promise.resolve(),
      syncing: {
        holdSyncing: (userId) => {
          held.push(userId);
          return Promise.resolve();
        },
        releaseSyncing: (userId) => {
          released.push(userId);
          return Promise.resolve();
        },
      },
      worker: {
        cancelJob: (jobId, reason) => {
          cancelled.push({ jobId, reason });
          return Promise.resolve();
        },
      },
    });

    await runtime.onJobActive({ jobId: "job-1", userId: "user-1" });
    await runtime.onJobActive({ jobId: "job-2", userId: "user-1" });
    await runtime.onJobCompleted({ jobId: "job-1", userId: "user-1" });
    await runtime.onJobCompleted({ jobId: "job-2", userId: "user-1" });

    expect(cancelled).toEqual([{ jobId: "job-1", reason: SUPERSEDED_REASON }]);
    expect(held).toEqual(["user-1", "user-1"]);
    expect(released).toEqual(["user-1"]);
  });

  it("deduplicates replayed active event by envelope id", async () => {
    const held: string[] = [];
    const runtime = createPushJobArbitrationRuntime({
      onRuntimeEvent: () => Promise.resolve(),
      syncing: {
        holdSyncing: (userId) => {
          held.push(userId);
          return Promise.resolve();
        },
        releaseSyncing: () => Promise.resolve(),
      },
      worker: {
        cancelJob: () => Promise.resolve(),
      },
    });

    await runtime.onJobActive({ jobId: "job-3", userId: "user-2" });
    await runtime.onJobActive({ jobId: "job-3", userId: "user-2" });

    expect(held).toEqual(["user-2"]);
  });

  it("serializes concurrent events per user without concurrency conflicts", async () => {
    const cancelled: { jobId: string; reason: string }[] = [];
    const held: string[] = [];
    const released: string[] = [];
    const runtime = createPushJobArbitrationRuntime({
      onRuntimeEvent: () => Promise.resolve(),
      syncing: {
        holdSyncing: (userId) => {
          held.push(userId);
          return Promise.resolve();
        },
        releaseSyncing: (userId) => {
          released.push(userId);
          return Promise.resolve();
        },
      },
      worker: {
        cancelJob: (jobId, reason) => {
          cancelled.push({ jobId, reason });
          return Promise.resolve();
        },
      },
    });

    await Promise.all([
      runtime.onJobActive({ jobId: "job-1", userId: "user-3" }),
      runtime.onJobActive({ jobId: "job-2", userId: "user-3" }),
    ]);
    await Promise.all([
      runtime.onJobCompleted({ jobId: "job-1", userId: "user-3" }),
      runtime.onJobCompleted({ jobId: "job-2", userId: "user-3" }),
    ]);

    expect(cancelled).toEqual([{ jobId: "job-1", reason: SUPERSEDED_REASON }]);
    expect(held).toEqual(["user-3", "user-3"]);
    expect(released).toEqual(["user-3"]);
  });
});

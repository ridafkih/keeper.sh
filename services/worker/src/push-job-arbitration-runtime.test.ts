import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import {
  PushJobArbitrationCommandType,
  type PushJobArbitrationEvent,
  type PushJobArbitrationCommand,
} from "@keeper.sh/state-machines";
import type { EventEnvelope } from "@keeper.sh/state-machines";
import {
  SUPERSEDED_REASON,
  createPushJobArbitrationRuntime,
} from "./push-job-arbitration-runtime";

const createEnvelopeFactory = (
  prefix: string,
): ((event: PushJobArbitrationEvent, jobId: string) => EventEnvelope<PushJobArbitrationEvent>) => {
  let sequence = 0;
  return (event, jobId) => {
    sequence += 1;
    return {
      actor: { id: "test-worker-bullmq", type: "system" },
      event,
      id: `${prefix}:${jobId}:${event.type}:${sequence}`,
      occurredAt: `2026-03-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    };
  };
};

describe("push job arbitration runtime", () => {
  it("supersedes active job and ignores stale completion", async () => {
    const cancelled: { jobId: string; reason: string }[] = [];
    const held: string[] = [];
    const released: string[] = [];
    const runtime = createPushJobArbitrationRuntime({
      createEnvelope: createEnvelopeFactory("runtime-1"),
      outboxStore: new InMemoryCommandOutboxStore<PushJobArbitrationCommand>(),
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
      createEnvelope: (event, jobId) => ({
        actor: { id: "test-worker-bullmq", type: "system" },
        event,
        id: `${event.type}:${jobId}`,
        occurredAt: "2026-03-20T00:00:01.000Z",
      }),
      outboxStore: new InMemoryCommandOutboxStore<PushJobArbitrationCommand>(),
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
      createEnvelope: createEnvelopeFactory("runtime-3"),
      outboxStore: new InMemoryCommandOutboxStore<PushJobArbitrationCommand>(),
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

  it("recovers and drains pending outbox commands", async () => {
    const held: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<PushJobArbitrationCommand>();
    await outboxStore.enqueue({
      aggregateId: "user-4",
      commands: [{ type: PushJobArbitrationCommandType.HOLD_SYNCING }],
      envelopeId: "recover-env-1",
      nextCommandIndex: 0,
    });

    const runtime = createPushJobArbitrationRuntime({
      createEnvelope: createEnvelopeFactory("runtime-4"),
      outboxStore,
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

    await runtime.recoverPending();

    expect(held).toEqual(["user-4"]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });

  it("fails fast when envelope metadata is invalid", async () => {
    const runtime = createPushJobArbitrationRuntime({
      createEnvelope: (event) => ({
        actor: { id: "test-worker-bullmq", type: "system" },
        event,
        id: "",
        occurredAt: "invalid-time",
      }),
      outboxStore: new InMemoryCommandOutboxStore<PushJobArbitrationCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      syncing: {
        holdSyncing: () => Promise.resolve(),
        releaseSyncing: () => Promise.resolve(),
      },
      worker: {
        cancelJob: () => Promise.resolve(),
      },
    });

    await expect(
      runtime.onJobActive({ jobId: "job-invalid", userId: "user-invalid" }),
    ).rejects.toThrow("push arbitration envelope id is required");
  });
});

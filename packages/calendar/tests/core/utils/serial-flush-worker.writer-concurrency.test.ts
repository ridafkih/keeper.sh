import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "../../../src/core/utils/serial-flush-worker";

const WRITER_CONCURRENCY = 16;
const SUBMISSIONS = 200;

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const finished: Promise<null> = Promise.resolve(null);

describe("serial flush worker writer concurrency", () => {
  it("runs at most writerConcurrency flushes at once", async () => {
    let running = 0;
    let peakRunning = 0;
    const worker = createSerialFlushWorker(
      async (task: () => Promise<null>) => {
        running += 1;
        peakRunning = Math.max(peakRunning, running);
        await settle();
        running -= 1;
        return await task();
      },
      { capacity: SUBMISSIONS, writerConcurrency: WRITER_CONCURRENCY },
    );

    await Promise.all(
      Array.from({ length: SUBMISSIONS }, () => worker.submit(() => finished)),
    );
    await worker.close();

    expect(peakRunning).toBeGreaterThan(1);
    expect(peakRunning).toBeLessThanOrEqual(WRITER_CONCURRENCY);
    expect(running).toBe(0);
  });

  it("stays strictly serial by default so existing callers are unchanged", async () => {
    let running = 0;
    let peakRunning = 0;
    const worker = createSerialFlushWorker(
      async (task: () => Promise<null>) => {
        running += 1;
        peakRunning = Math.max(peakRunning, running);
        await settle();
        running -= 1;
        return await task();
      },
      { capacity: SUBMISSIONS },
    );

    await Promise.all(
      Array.from({ length: 50 }, () => worker.submit(() => finished)),
    );
    await worker.close();

    expect(peakRunning).toBe(1);
  });

  it("frees every slot when a flush rejects", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<null>) => task(),
      { capacity: SUBMISSIONS, writerConcurrency: 4 },
    );

    const settled = await Promise.allSettled(
      Array.from({ length: 40 }, (_unused, index) => worker.submit(async () => {
        await finished;
        if (index % 2 === 0) {
          throw new Error("flush failed");
        }
        return null;
      })),
    );
    await worker.close();

    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(20);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(20);
  });

  it("keeps close() waiting for every in-flight flush", async () => {
    const worker = createSerialFlushWorker(
      async (task: () => Promise<null>) => {
        await settle();
        return await task();
      },
      { capacity: SUBMISSIONS, writerConcurrency: WRITER_CONCURRENCY },
    );

    let completed = 0;
    const submissions = Array.from({ length: 100 }, () => worker.submit(() => {
      completed += 1;
      return finished;
    }));

    await worker.close();
    expect(completed).toBe(100);
    await Promise.all(submissions);
  });
});

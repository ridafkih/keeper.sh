import { beforeEach, describe, expect, it, vi } from "vitest";

interface Beat {
  name: string;
  staleAfterMs: number;
}

interface HarnessState {
  beats: Beat[];
  events: Record<string, unknown>[];
  startSucceeds: boolean;
}

const harness = vi.hoisted((): HarnessState => ({
  beats: [],
  events: [],
  startSucceeds: true,
}));

vi.mock("@keeper.sh/heartbeat", () => ({
  createHeartbeat: (): object => ({
    beat: (name: string, staleAfterMs: number): void => {
      harness.beats.push({ name, staleAfterMs });
    },
    start: (): boolean => harness.startSucceeds,
  }),
  resolveHeartbeatFilePath: (service: string): string => `/tmp/keeper-${service}.heartbeat.json`,
}));

vi.mock("../src/utils/logging", () => {
  const fields = new Map<string, unknown>();
  return {
    context: (callback: () => unknown): unknown => callback(),
    widelog: {
      errorFields: (_error: unknown, options: { slug: string }): void => {
        fields.set("error.slug", options.slug);
      },
      flush: (): void => {
        harness.events.push(Object.fromEntries(fields));
        fields.clear();
      },
      set: (key: string, value: unknown): void => {
        fields.set(key, value);
      },
    },
  };
});

const FIFTEEN_MINUTES_MS = 900_000;

const jobOf = (callback: () => Promise<void> | void, cron = "@every_1_minutes") => ({
  callback,
  cron,
  name: "probe",
});

beforeEach(() => {
  harness.beats.length = 0;
  harness.events.length = 0;
  harness.startSucceeds = true;
});

describe("cron liveness", () => {
  it("records a job's progress only once its callback has finished", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const order: string[] = [];
    const job = withJobProgress(jobOf(async () => {
      await Promise.resolve();
      order.push(`ran with ${harness.beats.length} beats`);
    }));

    await job.callback();

    expect(order).toEqual(["ran with 0 beats"]);
    expect(harness.beats).toEqual([{ name: "job-probe", staleAfterMs: FIFTEEN_MINUTES_MS }]);
  });

  it("counts a failed run as progress, and still surfaces the failure", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const job = withJobProgress(jobOf(() => Promise.reject(new Error("redis unavailable"))));

    await expect(job.callback()).rejects.toThrow("redis unavailable");

    expect(harness.beats).toEqual([{ name: "job-probe", staleAfterMs: FIFTEEN_MINUTES_MS }]);
  });

  it("records no progress while a callback never settles", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const job = withJobProgress(jobOf(() => Promise.withResolvers<undefined>().promise));

    const settled = await Promise.race([
      Promise.resolve(job.callback()).then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 30);
      }),
    ]);

    expect(settled).toBe(false);
    expect(harness.beats).toEqual([]);
  });

  it("gives each job its own pulse, so one that hangs is not hidden by another that runs", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const hung = withJobProgress({
      ...jobOf(() => Promise.withResolvers<undefined>().promise),
      name: "hung",
    });
    const running = withJobProgress({ ...jobOf(() => Promise.resolve()), name: "running" });

    Promise.resolve(hung.callback()).catch(() => null);
    await running.callback();
    await running.callback();

    expect(harness.beats.map(({ name }) => name)).toEqual(["job-running", "job-running"]);
  });

  it("allows a job three of its own intervals when that is longer than fifteen minutes", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const job = withJobProgress(jobOf(() => Promise.resolve(), "@every_30_minutes"));

    await job.callback();

    expect(harness.beats).toEqual([{ name: "job-probe", staleAfterMs: 90 * 60_000 }]);
  });

  it("leaves a job alone when its schedule gives no fixed interval", async () => {
    const { withJobProgress } = await import("../src/liveness");
    const original = jobOf(() => Promise.resolve(), "@daily");

    const job = withJobProgress(original);
    await job.callback();

    expect(job).toBe(original);
    expect(harness.beats).toEqual([]);
  });

  it("keeps the schedule and name of the job it wraps", async () => {
    const { withJobProgress } = await import("../src/liveness");

    const job = withJobProgress({ ...jobOf(() => Promise.resolve()), overrunProtection: true });

    expect(job).toMatchObject({ cron: "@every_1_minutes", name: "probe", overrunProtection: true });
  });

  it("tracks each ingest lane as its own pulse, allowed twice the source timeout", async () => {
    const { laneProgressed } = await import("../src/liveness");

    laneProgressed("fleet")();
    laneProgressed("wake")();

    expect(harness.beats).toEqual([
      { name: "ingest-fleet", staleAfterMs: FIFTEEN_MINUTES_MS },
      { name: "ingest-wake", staleAfterMs: FIFTEEN_MINUTES_MS },
    ]);
  });

  it("logs that the heartbeat started only when the first write succeeded", async () => {
    const { startLiveness } = await import("../src/liveness");

    startLiveness();
    expect(harness.events).toEqual([expect.objectContaining({
      "heartbeat.path": "/tmp/keeper-cron.heartbeat.json",
      "operation.name": "heartbeat-start",
      "outcome": "success",
      "process.uid": process.getuid?.() ?? -1,
    })]);

    harness.events.length = 0;
    harness.startSucceeds = false;
    startLiveness();
    expect(harness.events).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELEASE_DELAY_MS } from "../src/active-destination-jobs";

interface SettledJob {
  data: { calendarId: string; userId: string };
  id: string;
  returnvalue: { continuationRequested: boolean };
}

interface HarnessState {
  cleanup: (() => Promise<void>) | null;
  jobsSettlingOnClose: SettledJob[];
  published: { channel: string; message: string }[];
  worker: { emit: (event: string, job: SettledJob) => void } | null;
}

const harness = vi.hoisted((): HarnessState => ({
  cleanup: null,
  jobsSettlingOnClose: [],
  published: [],
  worker: null,
}));

vi.mock("entrykit", async (importOriginal) => ({
  ...await importOriginal<object>(),
  entry: async (options: { main: () => Promise<() => Promise<void>> }): Promise<void> => {
    harness.cleanup = await options.main();
  },
}));

vi.mock("../src/env", () => ({
  default: {
    DATABASE_URL: "postgres://worker-test/keeper",
    REDIS_URL: "redis://worker-test:6379",
  },
}));

vi.mock("../src/liveness", () => ({
  createQueueJobFlow: (): object => ({
    track: <Result>(work: () => Result): Result => work(),
  }),
  startLiveness: (): null => null,
  startQueueProbe: (): (() => null) => (): null => null,
}));

vi.mock("../src/utils/safe-fetch-options", () => ({
  reportPrivateResolutionPolicy: (): null => null,
  safeFetchOptions: {},
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<object>(),
  closeDatabase: (): null => null,
  createDatabase: (): Promise<object> => Promise.resolve({}),
  createMigrationReadinessDatabase: (): object => ({}),
  waitForDatabaseMigrations: (): Promise<void> => Promise.resolve(),
}));

vi.mock("@keeper.sh/queue", () => ({
  PUSH_SYNC_QUEUE_NAME: "push-sync-v2",
  USER_TIMEOUT_MS: 300_000,
  createPushSyncQueue: (): object => ({
    add: (): Promise<void> => Promise.resolve(),
    close: (): Promise<void> => Promise.resolve(),
  }),
  resolvePushSyncJobId: (userId: string, calendarId: string): string => `sync-${userId}-${calendarId}`,
}));

vi.mock("bullmq", () => ({
  Worker: class FakeWorker {
    public client = Promise.resolve({ ping: (): Promise<string> => Promise.resolve("PONG") });
    private running = true;
    private readonly listeners = new Map<string, ((job: SettledJob) => void)[]>();

    public constructor() {
      harness.worker = this;
    }

    public on(event: string, listener: (job: SettledJob) => void): void {
      this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]);
    }

    public emit(event: string, job: SettledJob): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(job);
      }
    }

    public isRunning(): boolean {
      return this.running;
    }

    public close(): Promise<void> {
      this.running = false;
      for (const job of harness.jobsSettlingOnClose.splice(0)) {
        this.emit("completed", job);
      }
      return Promise.resolve();
    }
  },
}));

/* Mirrors ioredis: after disconnect() every command rejects "Connection is closed." */
vi.mock("ioredis", () => ({
  default: class FakeRedis {
    private closed = false;
    private readonly values = new Map<string, number>();

    public disconnect(): void {
      this.closed = true;
    }

    private command<Result>(result: () => Result): Promise<Result> {
      if (this.closed) {
        return Promise.reject(new Error("Connection is closed."));
      }
      return Promise.resolve(result());
    }

    public incr(key: string): Promise<number> {
      return this.command(() => {
        const next = (this.values.get(key) ?? 0) + 1;
        this.values.set(key, next);
        return next;
      });
    }

    public expire(): Promise<number> {
      return this.command(() => 1);
    }

    public eval(): Promise<number> {
      return this.command(() => 1);
    }

    public publish(channel: string, message: string): Promise<number> {
      return this.command(() => {
        harness.published.push({ channel, message });
        return 1;
      });
    }
  },
}));

const waitPastReleaseDebounce = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, DEFAULT_RELEASE_DELAY_MS + 250);
  });

describe("worker SIGTERM cleanup and the sync aggregate release", () => {
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.off("unhandledRejection", recordUnhandled);
  });

  it("publishes the release of a job that settles during worker.close() before Redis disconnects", async () => {
    process.on("unhandledRejection", recordUnhandled);
    await import("../src/index");

    expect(harness.cleanup).not.toBeNull();
    expect(harness.worker).not.toBeNull();

    const job: SettledJob = {
      data: { calendarId: "calendar-1", userId: "user-1" },
      id: "sync-user-1-calendar-1",
      returnvalue: { continuationRequested: false },
    };
    harness.worker?.emit("active", job);
    harness.jobsSettlingOnClose.push(job);

    await harness.cleanup?.();
    await waitPastReleaseDebounce();

    expect(unhandled).toEqual([]);
    const releases = harness.published
      .map(({ message }) => JSON.parse(message))
      .filter((message) => message.userId === "user-1" && message.event === "sync:aggregate");
    expect(releases.at(-1)?.data.syncing).toBe(false);
  });
});

import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAttemptDue, runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestDependencies, SourceIngestLease } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "1b4c6c4e-1d8e-4f0a-9f7f-9d5f4e2a1c33";
const MINUTE_MS = 60_000;
const TICK_MS = MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE_MS;
const START_AT = new Date("2026-03-08T09:30:00.000Z");

interface CalendarRow {
  ingestFailureCount: number;
  ingestLastFailureAt: Date | null;
  ingestNextAttemptAt: Date | null;
}

interface StoreOptions {
  isCurrent?: () => Promise<boolean>;
  acquireLease?: (calendarId: string, signal: AbortSignal) => Promise<SourceIngestLease | null>;
  applyBackoffError?: Error;
}

interface Store {
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  releases: number;
  row: CalendarRow;
  writes: string[];
}

const createStore = (row: CalendarRow, options: StoreOptions = {}): Store => {
  const recorded: CalendarBackoffState[] = [];
  const writes: string[] = [];
  const store = {
    recorded,
    releases: 0,
    row,
    writes,
  } as Store;

  store.dependencies = {
    acquireLease: options.acquireLease ?? (() => Promise.resolve({
      isCurrent: options.isCurrent ?? (() => Promise.resolve(true)),
      release: () => {
        store.releases += 1;
        return Promise.resolve();
      },
    })),
    applyBackoff: (_calendarId, observedAttempt) => {
      if (options.applyBackoffError) {
        return Promise.reject(options.applyBackoffError);
      }
      const state = buildCalendarBackoffState(observedAttempt.failureCount, new Date());
      store.row.ingestFailureCount = state.failureCount;
      store.row.ingestLastFailureAt = state.lastFailureAt;
      store.row.ingestNextAttemptAt = state.nextAttemptAt;
      writes.push("apply");
      return Promise.resolve(state);
    },
    readAttempt: () => Promise.resolve({
      failureCount: store.row.ingestFailureCount,
      nextAttemptAt: store.row.ingestNextAttemptAt,
    }),
    recordBackoff: (state) => {
      recorded.push(state);
    },
    resetBackoff: () => {
      store.row.ingestFailureCount = 0;
      store.row.ingestLastFailureAt = null;
      store.row.ingestNextAttemptAt = null;
      writes.push("reset");
      return Promise.resolve();
    },
  };

  return store;
};

const freshRow = (): CalendarRow => ({
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
});

const credentialError = (flag: string): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), { [flag]: true });

const liveSignal = (): AbortSignal => new AbortController().signal;

const tick = (
  store: Store,
  work: () => Promise<unknown>,
): Promise<unknown> =>
  runSourceIngest(store.dependencies, CALENDAR_ID, liveSignal(), work)
    .catch((error: unknown) => error);

describe("runSourceIngest convergence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops re-attempting a dead credential on every scheduler tick", async () => {
    const store = createStore(freshRow());
    const failure = credentialError("oauthReauthRequired");
    const counter = { attempts: 0 };
    const failingWork = (): Promise<never> => {
      counter.attempts += 1;
      return Promise.reject(failure);
    };

    for (let elapsed = 0; elapsed < DAY_MS; elapsed += TICK_MS) {
      vi.setSystemTime(new Date(START_AT.getTime() + elapsed));
      await tick(store, failingWork);
    }

    const { attempts } = counter;

    expect(attempts).toBeLessThanOrEqual(10);
    expect(attempts).toBeGreaterThan(0);
  });

  it("grows the delay monotonically and settles at the cap", async () => {
    const store = createStore(freshRow());
    const failure = credentialError("authRequired");
    const delays: number[] = [];

    for (let index = 0; index < 12; index += 1) {
      const before = Date.now();
      await tick(store, () => Promise.reject(failure));
      const next = store.row.ingestNextAttemptAt;
      expect(next).not.toBeNull();
      delays.push((next as Date).getTime() - before);
      vi.setSystemTime(next as Date);
    }

    expect(delays.slice(0, 7)).toEqual([
      5 * MINUTE_MS,
      10 * MINUTE_MS,
      20 * MINUTE_MS,
      40 * MINUTE_MS,
      80 * MINUTE_MS,
      160 * MINUTE_MS,
      320 * MINUTE_MS,
    ]);
    expect(delays.slice(7)).toEqual(Array.from({ length: 5 }, () => MAX_BACKOFF_MS));
    expect(store.row.ingestFailureCount).toBe(12);
  });

  it("writes nothing on ticks that fall inside the backoff window", async () => {
    const store = createStore(freshRow());
    await tick(store, () => Promise.reject(credentialError("authRequired")));
    const afterFirstFailure = { ...store.row };
    store.writes.length = 0;

    for (let index = 1; index <= 4; index += 1) {
      vi.setSystemTime(new Date(START_AT.getTime() + index * MINUTE_MS));
      const result = await tick(store, () => Promise.reject(new Error("must not run")));
      expect(result).toBeNull();
    }

    expect(store.writes).toEqual([]);
    expect(store.row).toEqual(afterFirstFailure);
  });

  it("resumes immediately once the source recovers and does not re-arm the backoff", async () => {
    const store = createStore(freshRow());
    await tick(store, () => Promise.reject(credentialError("authRequired")));
    vi.setSystemTime(store.row.ingestNextAttemptAt as Date);

    const recovered = await tick(store, () => Promise.resolve("ingested"));

    expect(recovered).toBe("ingested");
    expect(store.row).toEqual(freshRow());

    const immediate = await tick(store, () => Promise.resolve("ingested-again"));
    expect(immediate).toBe("ingested-again");
    expect(store.row).toEqual(freshRow());
  });

  it("restarts the exponent after a recovery rather than compounding old failures", async () => {
    const store = createStore(freshRow());

    for (let index = 0; index < 4; index += 1) {
      await tick(store, () => Promise.reject(credentialError("authRequired")));
      vi.setSystemTime(store.row.ingestNextAttemptAt as Date);
    }
    expect(store.row.ingestFailureCount).toBe(4);

    await tick(store, () => Promise.resolve("ingested"));
    expect(store.row.ingestFailureCount).toBe(0);

    const before = Date.now();
    await tick(store, () => Promise.reject(credentialError("authRequired")));
    expect((store.row.ingestNextAttemptAt as Date).getTime() - before).toBe(5 * MINUTE_MS);
  });

  it("treats an attempt due exactly now as due", async () => {
    const now = new Date(START_AT);
    expect(isAttemptDue({ failureCount: 3, nextAttemptAt: now }, now)).toBe(true);
    expect(isAttemptDue({ failureCount: 3, nextAttemptAt: null }, now)).toBe(true);
    expect(isAttemptDue(
      { failureCount: 3, nextAttemptAt: new Date(now.getTime() + 1) },
      now,
    )).toBe(false);

    const store = createStore({
      ingestFailureCount: 3,
      ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
      ingestNextAttemptAt: new Date(START_AT),
    });
    const result = await tick(store, () => Promise.resolve("ingested"));
    expect(result).toBe("ingested");
  });

  it("does nothing and releases the lease when the calendar row has vanished", async () => {
    const store = createStore(freshRow());
    store.dependencies = { ...store.dependencies, readAttempt: () => Promise.resolve(null) };

    const result = await tick(store, () => Promise.reject(new Error("must not run")));

    expect(result).toBeNull();
    expect(store.writes).toEqual([]);
    expect(store.releases).toBe(1);
  });

  it("releases the lease when reading the attempt row fails", async () => {
    const store = createStore(freshRow());
    const readFailure = new Error("connection terminated unexpectedly");
    store.dependencies = { ...store.dependencies, readAttempt: () => Promise.reject(readFailure) };

    expect(await tick(store, () => Promise.resolve("ingested"))).toBe(readFailure);
    expect(store.releases).toBe(1);
    expect(store.writes).toEqual([]);
  });

  it("skips silently when the lease is taken, and surfaces an abort when the run is cancelled", async () => {
    const busy = createStore(freshRow(), { acquireLease: () => Promise.resolve(null) });
    expect(await runSourceIngest(
      busy.dependencies,
      CALENDAR_ID,
      liveSignal(),
      () => Promise.reject(new Error("must not run")),
    )).toBeNull();
    expect(busy.writes).toEqual([]);

    const aborted = createStore(freshRow(), { acquireLease: () => Promise.resolve(null) });
    const controller = new AbortController();
    controller.abort();
    const result = await runSourceIngest(
      aborted.dependencies,
      CALENDAR_ID,
      controller.signal,
      () => {
        throw new Error("must not run");
      },
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(aborted.writes).toEqual([]);
  });

  it("keeps a reconnect that lands mid-ingest from being undone by the failing run", async () => {
    const store = createStore({
      ingestFailureCount: 9,
      ingestLastFailureAt: new Date(START_AT.getTime() - MAX_BACKOFF_MS),
      ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
    });

    const failure = credentialError("oauthReauthRequired");
    await tick(store, () => {
      store.row.ingestFailureCount = 0;
      store.row.ingestLastFailureAt = null;
      store.row.ingestNextAttemptAt = null;
      return Promise.reject(failure);
    });

    expect(store.row).toEqual(freshRow());
  });

  it("reports the ingest failure, not the bookkeeping failure, when the backoff write fails", async () => {
    const writeFailure = new Error("could not serialize access due to concurrent update");
    const store = createStore(freshRow(), { applyBackoffError: writeFailure });
    const failure = credentialError("oauthReauthRequired");

    const result = await tick(store, () => Promise.reject(failure));

    expect(result).toBe(failure);
  });

  it("does not turn a successful ingest into a failure when the lease check throws", async () => {
    const leaseFailure = new Error("Failed to renew sync lock for calendar");
    const store = createStore(
      {
        ingestFailureCount: 2,
        ingestLastFailureAt: new Date(START_AT.getTime() - MINUTE_MS),
        ingestNextAttemptAt: new Date(START_AT.getTime() - MINUTE_MS),
      },
      { isCurrent: () => Promise.reject(leaseFailure) },
    );

    const result = await tick(store, () => Promise.resolve("ingested"));

    expect(result).toBe("ingested");
    expect(store.writes).not.toContain("apply");
  });
});

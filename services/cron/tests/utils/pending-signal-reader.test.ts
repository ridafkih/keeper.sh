import { describe, expect, it, vi } from "vitest";
import {
  PENDING_CORRELATION_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  PENDING_SIGNAL_KEY,
} from "@keeper.sh/calendar";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";
import type { DrainPendingIngestDependencies } from "../../src/utils/drain-pending-ingest";
import { createScopedClaimPending } from "../../src/utils/scoped-drain-pending-ingest";
import { createPendingSignalReader } from "../../src/utils/pending-signal-consumer";

type IngestCalendars = DrainPendingIngestDependencies["ingestCalendars"];

const NOW_MS = new Date("2026-08-18T00:00:00.000Z").getTime();
const CONCURRENCY_LIMIT = 2;
const FLUSH_ROUNDS = 5;

/*
 * Draining the event loop is how "no further read was issued" is observed without asserting
 * on elapsed time: every continuation the reader could have taken has already run.
 */
const flushEventLoop = async (): Promise<void> => {
  for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
    await new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 0);
    });
  }
};

const createFakeBlockingRedis = () => {
  const waiters: ((reply: [string, string] | null) => void)[] = [];
  const arrivals: (() => void)[] = [];
  let blpopCalls = 0;
  let disconnected = false;

  return {
    blpop: (key: string, timeoutSeconds: number): Promise<[string, string] | null> => {
      expect(key).toBe(PENDING_SIGNAL_KEY);
      expect(timeoutSeconds).toBeGreaterThan(0);
      blpopCalls += 1;
      if (disconnected) {
        return Promise.resolve(null);
      }
      return new Promise<[string, string] | null>((resolve) => {
        waiters.push(resolve);
        for (const arrival of arrivals.splice(0)) {
          arrival();
        }
      });
    },
    blpopCalls: (): number => blpopCalls,
    deliver: async (calendarId: string): Promise<void> => {
      if (waiters.length === 0) {
        await new Promise<null>((resolve) => {
          arrivals.push(() => resolve(null));
        });
      }
      const waiter = waiters.shift();
      waiter?.([PENDING_SIGNAL_KEY, calendarId]);
    },
    disconnect: (): void => {
      disconnected = true;
      for (const waiter of waiters.splice(0)) {
        waiter(null);
      }
    },
    isDisconnected: (): boolean => disconnected,
    openReads: (): number => waiters.length,
  };
};

const createControlledDrain = (events: string[]) => {
  const finishers = new Map<string, () => void>();
  const startWatchers: (() => void)[] = [];
  let startCount = 0;

  return {
    drainCalendars: (calendarIds: string[]): Promise<void> => {
      const label = calendarIds.join(",");
      startCount += 1;
      events.push(`start:${label}`);
      for (const watcher of startWatchers.splice(0)) {
        watcher();
      }
      return new Promise<void>((resolve) => {
        finishers.set(label, () => {
          events.push(`end:${label}`);
          resolve();
        });
      });
    },
    finish: (label: string): void => {
      const finisher = finishers.get(label);
      if (!finisher) {
        throw new Error(`no in-flight drain for ${label}`);
      }
      finishers.delete(label);
      finisher();
    },
    startCount: (): number => startCount,
    waitForStarts: async (count: number): Promise<void> => {
      for (;;) {
        if (startCount >= count) {
          return;
        }
        await new Promise<null>((resolve) => {
          startWatchers.push(() => resolve(null));
        });
      }
    },
  };
};

interface PendingFixture {
  correlationIds: Map<string, string>;
  scores: Map<string, number>;
}

const createFakePendingRedis = (fixture: PendingFixture) => {
  const reserved = new Set<string>();
  return {
    del: (...keys: string[]) => {
      for (const key of keys) {
        reserved.delete(key);
      }
      return Promise.resolve(keys.length);
    },
    hmget: (key: string, ...members: string[]) => {
      if (key === PENDING_REWAKE_KEY) {
        return Promise.resolve(members.map((member) => {
          if (fixture.scores.has(member)) {
            return "1";
          }
          return null;
        }));
      }
      expect(key).toBe(PENDING_CORRELATION_KEY);
      return Promise.resolve(members.map((member) => fixture.correlationIds.get(member) ?? null));
    },
    hsetnx: (): Promise<number> => Promise.resolve(0),
    set: (key: string) => {
      if (reserved.has(key)) {
        return Promise.resolve(null);
      }
      reserved.add(key);
      return Promise.resolve("OK");
    },
    zscore: (key: string, member: string) => {
      expect(key).toBe(PENDING_INGEST_KEY);
      const score = fixture.scores.get(member) ?? null;
      if (score === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve(String(score));
    },
  };
};

const makeScopedDependencies = (
  fixture: PendingFixture,
  scopedIds: string[],
  ingestCalendars: IngestCalendars,
): DrainPendingIngestDependencies => ({
  claimPending: createScopedClaimPending(createFakePendingRedis(fixture), scopedIds),
  countPending: () => Promise.resolve(fixture.scores.size),
  enabled: true,
  enqueueDestinationSyncs: () => Promise.resolve(),
  ingestCalendars,
  now: () => new Date(NOW_MS + 1000),
  observe: () => {
    // Telemetry has its own tests; this spec asserts what was ingested.
  },
  recordError: () => {
    // Drain-level failures are out of this spec's scope.
  },
  recordFailures: (calendarIds: string[]) =>
    Promise.resolve(Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1]))),
  releaseAbandoned: () => Promise.resolve(),
  releaseClaims: () => Promise.resolve(),
  releasePending: (members) => Promise.resolve(members.map((member) => member.calendarId)),
  resolveCalendars: (calendarIds: string[]) =>
    Promise.resolve(calendarIds.map((calendarId) => ({ calendarId, userId: "user-1" }))),
  resolvePlan: () => Promise.resolve("pro" as const),
});

const noopRecordError = (): void => {
  // These tests assert drains, not error routing.
};

describe("pending signal reader", () => {
  it("drains a signalled calendar as soon as the blocking read returns it", async () => {
    const events: string[] = [];
    const blockingRedis = createFakeBlockingRedis();
    const drain = createControlledDrain(events);
    const reader = createPendingSignalReader({
      blockingRedis,
      concurrencyLimit: CONCURRENCY_LIMIT,
      drainCalendars: drain.drainCalendars,
      recordError: noopRecordError,
    });

    reader.start();
    await blockingRedis.deliver("cal-a");
    await drain.waitForStarts(1);

    expect(events).toEqual(["start:cal-a"]);

    drain.finish("cal-a");
    await reader.stop();
  });

  it("bounds concurrent scoped drains instead of reading ahead per signal", async () => {
    const events: string[] = [];
    const blockingRedis = createFakeBlockingRedis();
    const drain = createControlledDrain(events);
    const reader = createPendingSignalReader({
      blockingRedis,
      concurrencyLimit: CONCURRENCY_LIMIT,
      drainCalendars: drain.drainCalendars,
      recordError: noopRecordError,
    });

    reader.start();
    await blockingRedis.deliver("cal-1");
    await drain.waitForStarts(1);
    await blockingRedis.deliver("cal-2");
    await drain.waitForStarts(2);
    await flushEventLoop();

    expect(drain.startCount()).toBe(CONCURRENCY_LIMIT);
    expect(blockingRedis.blpopCalls()).toBe(CONCURRENCY_LIMIT);

    const thirdDelivery = blockingRedis.deliver("cal-3");
    drain.finish("cal-1");
    await thirdDelivery;
    await drain.waitForStarts(3);

    expect(events).toEqual(["start:cal-1", "start:cal-2", "end:cal-1", "start:cal-3"]);

    drain.finish("cal-2");
    drain.finish("cal-3");
    await reader.stop();
  });

  it("ingests nothing when the signalled calendar is no longer pending", async () => {
    const fixture: PendingFixture = {
      correlationIds: new Map([["cal-live", "corr-live"]]),
      scores: new Map([["cal-live", NOW_MS]]),
    };
    const ingestCalendars = vi.fn<IngestCalendars>(() =>
      Promise.resolve({ affectedUserIds: ["user-1"] }));
    const drained: string[][] = [];
    const blockingRedis = createFakeBlockingRedis();
    const reader = createPendingSignalReader({
      blockingRedis,
      concurrencyLimit: CONCURRENCY_LIMIT,
      drainCalendars: async (calendarIds: string[]) => {
        drained.push(calendarIds);
        await runDrainPendingIngest(makeScopedDependencies(fixture, calendarIds, ingestCalendars));
      },
      recordError: noopRecordError,
    });

    reader.start();
    await blockingRedis.deliver("cal-gone");
    await blockingRedis.deliver("cal-live");
    await reader.stop();

    expect(drained).toEqual([["cal-gone"], ["cal-live"]]);
    expect(ingestCalendars.mock.calls.map(([calendarIds]) => calendarIds)).toEqual([["cal-live"]]);
  });

  it("disconnects its blocking connection and finishes a signal it already took", async () => {
    const events: string[] = [];
    const blockingRedis = createFakeBlockingRedis();
    const drain = createControlledDrain(events);
    const reader = createPendingSignalReader({
      blockingRedis,
      concurrencyLimit: CONCURRENCY_LIMIT,
      drainCalendars: drain.drainCalendars,
      recordError: noopRecordError,
    });

    reader.start();
    await blockingRedis.deliver("cal-taken");
    await drain.waitForStarts(1);

    const stopped = (async (): Promise<void> => {
      await reader.stop();
      events.push("stopped");
    })();
    await flushEventLoop();

    expect(events).toEqual(["start:cal-taken"]);

    drain.finish("cal-taken");
    await stopped;

    expect(events).toEqual(["start:cal-taken", "end:cal-taken", "stopped"]);
    expect(blockingRedis.isDisconnected()).toBe(true);
    expect(blockingRedis.openReads()).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestWideEventFields } from "@keeper.sh/calendar";

/*
 * Preemption buys webhook latency by throwing away provider reads already paid for. That
 * trade can only be priced after deploy if the cut-short pass says so on its own wide event:
 * the engine returns the same empty result whether it was superseded or the source was quiet,
 * so an emitted field is the only thing that separates the two in the logs.
 */

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const lockState = { isCurrent: true };
let current: WideEvent = { fields: {}, values: {} };

const resolveEngineOutcome = (stillCurrent: boolean): string => {
  if (stillCurrent) {
    return "success";
  }
  return "superseded";
};

const ENGINE_WIDE_EVENT: IngestWideEventFields = {
  "calendar.id": "calendar-1",
  "duration_ms": 12,
  "events.added": 0,
  "events.removed": 0,
  "operation.name": "ingest:source",
  "operation.type": "ingest",
  "outcome": "success",
  "source_events.count": 0,
};

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    ENCRYPTION_KEY: "0".repeat(64),
    WORKER_JOB_QUEUE_ENABLED: false,
  },
}));

vi.mock("@/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(null),
}));

const ICS_SOURCE = {
  calendarId: "calendar-1",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowRecordedAt: null,
  treatFullDayTimedEventsAsAllDay: false,
  url: "https://example.com/feed.ics",
  userId: "user-1",
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") || keys.has("encryptedPassword")) {
    return [];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [ICS_SOURCE];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
};

const createQuery = (resolve: () => unknown): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });

vi.mock("@/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
    update: () => createQuery(() => []),
  },
  refreshLockRedis: {},
  refreshLockStore: {},
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(lockState.isCurrent),
        isHeld: () => Promise.resolve(true),
        release: () => Promise.resolve(null),
      },
    }),
  }),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: async (options: {
    isCurrent?: () => Promise<boolean>;
    onIngestEvent?: (event: IngestWideEventFields) => void;
  }) => {
    /* The engine probes currency itself and flushes nothing when the answer is no. */
    const stillCurrent = await options.isCurrent?.() ?? true;
    options.onIngestEvent?.({
      ...ENGINE_WIDE_EVENT,
      outcome: resolveEngineOutcome(stillCurrent),
    });
    return { eventsAdded: 0, eventsRemoved: 0 };
  },
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const sourceEvent = (): WideEvent => {
  const event = emitted.find(({ values }) => values["operation.name"] === "ingest-source");
  if (!event) {
    throw new Error("no per-source wide event was emitted");
  }
  return event;
};

const runIngest = async (isCurrent: boolean): Promise<WideEvent> => {
  lockState.isCurrent = isCurrent;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
  return sourceEvent();
};

describe("an ingest cut short by a preempting waiter", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
    lockState.isCurrent = true;
  });

  it("says so on its own wide event", async () => {
    const { values } = await runIngest(false);

    expect(values["ingest.superseded"]).toBe(true);
  });

  /*
   * Without the pairing outcome the field cannot be joined to anything: a superseded pass
   * flushed nothing, so it must not read as a completed one.
   */
  it("does not also claim the pass succeeded", async () => {
    const { values } = await runIngest(false);

    expect(values["outcome"]).toBe("skipped");
  });

  /* Absent, not false: a rate is only meaningful if a quiet-but-current pass never carries it. */
  it("leaves the field off an ingest that kept its lock", async () => {
    const { values } = await runIngest(true);

    expect(values["outcome"]).toBe("success");
    expect(values).not.toHaveProperty("ingest.superseded");
  });
});

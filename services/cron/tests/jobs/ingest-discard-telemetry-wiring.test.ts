import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestWideEventFields } from "@keeper.sh/calendar";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const ingestOptions: { onIngestEvent?: (event: IngestWideEventFields) => void }[] = [];
let current: WideEvent = { fields: {}, values: {} };

const ENGINE_WIDE_EVENT: IngestWideEventFields = {
  "calendar.id": "calendar-1",
  "duration_ms": 12,
  "events.added": 0,
  "events.removed": 0,
  "operation.name": "ingest:source",
  "operation.type": "ingest",
  "outcome": "success",
  "source_events.count": 3,
  "source_events.discarded_outside_window": 2,
  "source_events.discarded_unrepresentable": 1,
  "source_events.unsupported_uids": "moved@example.com",
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
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(null),
      },
    }),
  }),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: (options: { onIngestEvent?: (event: IngestWideEventFields) => void }) => {
    ingestOptions.push(options);
    options.onIngestEvent?.(ENGINE_WIDE_EVENT);
    return Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 });
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

describe("the ingest job reads the engine's wide event rather than discarding it", () => {
  beforeEach(async () => {
    emitted.length = 0;
    ingestOptions.length = 0;
    current = { fields: {}, values: {} };
    await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
  });

  it("hands the engine an onIngestEvent callback", () => {
    expect(ingestOptions).toHaveLength(1);
    expect(ingestOptions[0]?.onIngestEvent).toBeTypeOf("function");
  });

  it("puts every discard counter onto the per-source wide event", () => {
    const { values } = sourceEvent();

    expect(values["source_events.discarded_unrepresentable"]).toBe(1);
    expect(values["source_events.discarded_outside_window"]).toBe(2);
    expect(values["source_events.count"]).toBe(3);
    expect(values["source_events.unsupported_uids"]).toBe("moved@example.com");
  });

  it("namespaces the engine's outcome instead of overwriting the job's own", () => {
    const { values } = sourceEvent();

    expect(values["ingest.outcome"]).toBe("success");
    expect(values["ingest.duration_ms"]).toBe(12);
    expect(values["operation.name"]).toBe("ingest-source");
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { createDefaultDependencies as createDrainDependencies } from "../../src/jobs/drain-pending-ingest";

const harness = vi.hoisted(() => {
  interface IngestionBatchShape {
    abortedCalendarIds: string[];
    added: number;
    affectedUserIds: string[];
    errors: number;
    firstIngestUserIds: string[];
    removed: number;
  }

  const state: { batchResult: IngestionBatchShape; requestedCalendarIds: string[][] } = {
    batchResult: {
      abortedCalendarIds: [],
      added: 0,
      affectedUserIds: [],
      errors: 0,
      firstIngestUserIds: [],
      removed: 0,
    },
    requestedCalendarIds: [],
  };

  const ingestOAuthSources = vi.fn((calendarIds: string[]): Promise<IngestionBatchShape> => {
    state.requestedCalendarIds.push(calendarIds);
    return Promise.resolve(state.batchResult);
  });

  return { ingestOAuthSources, state };
});

const environment = { WEBHOOK_PUBLIC_URL: "https://www.example.com" };

vi.mock("../../src/env", () => ({ default: environment }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    eval: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    hdel: () => Promise.resolve(0),
    hincrby: () => Promise.resolve(1),
    hmget: () => Promise.resolve([]),
    zcard: () => Promise.resolve(0),
    zrange: () => Promise.resolve([]),
    zrem: () => Promise.resolve(0),
  },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/jobs/ingest-sources", () => ({
  ingestOAuthSources: harness.ingestOAuthSources,
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

let createDefaultDependencies: typeof createDrainDependencies | null = null;

beforeAll(async () => {
  ({ createDefaultDependencies } = await import("../../src/jobs/drain-pending-ingest"));
});

beforeEach(() => {
  harness.state.requestedCalendarIds.length = 0;
  harness.state.batchResult = {
    abortedCalendarIds: [],
    added: 0,
    affectedUserIds: [],
    errors: 0,
    firstIngestUserIds: [],
    removed: 0,
  };
});

describe("a pass that already committed when a sibling's moved baseline surfaces", () => {
  it("keeps the committed calendar's affected user when a sibling aborted", async () => {
    harness.state.batchResult = {
      abortedCalendarIds: ["calendar-aborted"],
      added: 3,
      affectedUserIds: ["user-committed"],
      errors: 0,
      firstIngestUserIds: ["user-committed"],
      removed: 1,
    };
    const dependencies = await createDefaultDependencies?.();

    const outcome = await dependencies?.ingestCalendars(
      ["calendar-committed", "calendar-aborted"],
      {},
    );

    expect(outcome?.affectedUserIds).toEqual(["user-committed"]);
  });

  it("still reports the committed calendar when it is the only newly connected one", async () => {
    harness.state.batchResult = {
      abortedCalendarIds: ["calendar-aborted"],
      added: 12,
      affectedUserIds: ["user-first-ingest"],
      errors: 0,
      firstIngestUserIds: ["user-first-ingest"],
      removed: 0,
    };
    const dependencies = await createDefaultDependencies?.();

    const outcome = await dependencies?.ingestCalendars(
      ["calendar-first-ingest", "calendar-aborted"],
      {},
    );

    expect(outcome?.affectedUserIds).toContain("user-first-ingest");
  });

  it("reports an uncontended batch unchanged", async () => {
    harness.state.batchResult = {
      abortedCalendarIds: [],
      added: 2,
      affectedUserIds: ["user-quiet"],
      errors: 0,
      firstIngestUserIds: [],
      removed: 0,
    };
    const dependencies = await createDefaultDependencies?.();

    const outcome = await dependencies?.ingestCalendars(["calendar-quiet"], {});

    expect(outcome?.affectedUserIds).toEqual(["user-quiet"]);
  });
});

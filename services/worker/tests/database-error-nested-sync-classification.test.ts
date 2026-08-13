import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { fields: {}, values: {} };
let syncOutcome: () => unknown = () => ({
  added: 0,
  addFailed: 0,
  errors: [],
  removed: 0,
  removeFailed: 0,
  syncEvents: [],
});

vi.mock("../src/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  destroy: () => null,
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    errors: () => null,
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
      return { sticky: () => null };
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("../src/env", () => ({
  default: {
    ENCRYPTION_KEY: "0".repeat(64),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client",
    MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  },
}));

vi.mock("../src/context", () => ({
  database: {},
  refreshLockRedis: {},
  refreshLockStore: {},
  shutdownConnections: () => null,
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createBroadcastService: () => ({ emit: () => null }),
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncAggregateRuntime: () => ({
    onDestinationSync: () => Promise.resolve(),
    onSyncProgress: () => null,
  }),
  SyncLockRenewalError: class SyncLockRenewalError extends Error {},
  syncDestinationsForUser: () => Promise.resolve(syncOutcome()),
}));

const { processJob } = await import("../src/processor");

const createJob = () => ({
  data: {
    calendarId: "calendar-1",
    correlationId: "correlation-1",
    plan: "pro",
    userId: "user-1",
  },
  id: "job-1",
  name: "push-sync",
  updateProgress: () => null,
});

const runFailingJob = async (error: unknown): Promise<WideEvent> => {
  syncOutcome = () => {
    throw error;
  };
  await expect(
    (processJob as unknown as (job: unknown) => Promise<unknown>)(createJob()),
  ).rejects.toThrow();
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

const PROVIDER_SLUGS = new Set([
  "provider-api-error",
  "provider-api-timeout",
  "provider-auth-failed",
  "provider-rate-limited",
  "sync-push-conflict",
]);

const UPSERT_QUERY =
  'insert into "source_destination_mappings" ("id", "uid") values ($1, $2) '
  + 'on conflict ("id") do update set "uid" = excluded."uid"';

const deadlock = (): Error =>
  Object.assign(new Error("deadlock detected"), {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "40P01",
    name: "PostgresError",
  });

const drizzleFailure = (params: unknown[] = ["mapping-1", "uid-1"]): DrizzleQueryError =>
  new DrizzleQueryError(UPSERT_QUERY, params, deadlock());

describe("worker classification of database failures nested inside other errors", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
  });

  it("classifies a database failure re-thrown inside a transaction wrapper", async () => {
    const event = await runFailingJob(
      new Error("transaction rolled back", { cause: drizzleFailure() }),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
    expect(event.fields.slug).toBe("db-query-failed");
  });

  it("classifies a database failure two wrappers deep", async () => {
    const event = await runFailingJob(
      new Error("destination flush failed", {
        cause: new Error("transaction rolled back", { cause: drizzleFailure() }),
      }),
    );

    expect(event.fields.slug).toBe("db-query-failed");
  });

  it("classifies a database failure carried by an AggregateError", async () => {
    const event = await runFailingJob(
      new AggregateError(
        [new Error("provider returned 500"), drizzleFailure()],
        "all destination flushes failed",
      ),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
  });

  it("does not let a bound parameter decide the slug", async () => {
    const event = await runFailingJob(
      drizzleFailure(["mapping-1", "429 rate limit timeout conflict@keeper.sh"]),
    );

    expect(event.fields.slug).toBe("db-query-failed");
  });

  it("keeps the same slug across every retry of a nested incident", async () => {
    const slugs: unknown[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      emitted.length = 0;
      const event = await runFailingJob(
        new Error("transaction rolled back", { cause: drizzleFailure() }),
      );
      slugs.push(event.fields.slug);
    }

    expect(new Set(slugs).size).toBe(1);
  });
});

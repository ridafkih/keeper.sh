import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { fields: {}, values: {} };
let calendarFailure:
  | ((handlers: { onCalendarError: (failure: Record<string, unknown>) => void }) => void)
  | null = null;
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
  syncDestinationsForUser: (
    _userId: string,
    _options: unknown,
    handlers: { onCalendarError: (failure: Record<string, unknown>) => void },
  ) => {
    calendarFailure?.(handlers);
    return Promise.resolve(syncOutcome());
  },
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

const runProcessJob = (): Promise<unknown> =>
  (processJob as unknown as (job: unknown) => Promise<unknown>)(createJob());

const createPostgresError = (fields: Record<string, unknown>): Error =>
  Object.assign(new Error(String(fields.message ?? "postgres failure")), fields);

const wrapInDrizzle = (query: string, cause: Error): Error =>
  new DrizzleQueryError(query, [], cause);

const runFailingJob = async (error: Error): Promise<WideEvent> => {
  syncOutcome = () => {
    throw error;
  };
  await expect(
    runProcessJob(),
  ).rejects.toThrow();
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

const MAPPING_UPSERT_QUERY =
  'insert into "source_destination_mappings" ("id", "source_event_id", "destination_event_id") values ($1, $2, $3) on conflict do nothing';

const SYNC_STATUS_UPSERT_QUERY =
  'insert into "sync_status" ("calendar_id", "last_synced_at") values ($1, $2) on conflict ("calendar_id") do update set "last_synced_at" = $3';

const PROVIDER_SLUGS = new Set([
  "provider-api-error",
  "provider-api-timeout",
  "provider-auth-failed",
  "provider-rate-limited",
  "sync-push-conflict",
]);

describe("worker sync-error classification for database failures", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
    calendarFailure = null;
  });

  it("does not read a per-calendar database failure as a provider push conflict", async () => {
    calendarFailure = (handlers) => {
      handlers.onCalendarError({
        accountId: "account-1",
        calendarId: "calendar-1",
        durationMs: 12,
        error: wrapInDrizzle(
          MAPPING_UPSERT_QUERY,
          createPostgresError({
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "23505",
            message: "duplicate key value violates unique constraint \"source_destination_mappings_pkey\"",
          }),
        ),
        provider: "google",
      });
    };
    syncOutcome = () => ({
      added: 0,
      addFailed: 0,
      errors: [],
      removed: 0,
      removeFailed: 0,
      syncEvents: [],
    });

    await runProcessJob();
    const [event] = emitted;

    expect(PROVIDER_SLUGS.has(String(event?.fields.slug))).toBe(false);
  });

  it("records the database diagnostics beside a per-calendar database failure", async () => {
    calendarFailure = (handlers) => {
      handlers.onCalendarError({
        accountId: "account-1",
        calendarId: "calendar-1",
        durationMs: 12,
        error: wrapInDrizzle(
          MAPPING_UPSERT_QUERY,
          createPostgresError({
            code: "ERR_POSTGRES_CONNECTION_CLOSED",
            message: "Connection closed",
          }),
        ),
        provider: "google",
      });
    };
    syncOutcome = () => ({
      added: 0,
      addFailed: 0,
      errors: [],
      removed: 0,
      removeFailed: 0,
      syncEvents: [],
    });

    await runProcessJob();
    const [event] = emitted;

    expect(event?.fields.slug).toBe("db-connection-unavailable");
  });

  it("labels a pool failure raised during a push as a database failure", async () => {
    const event = await runFailingJob(
      wrapInDrizzle(
        MAPPING_UPSERT_QUERY,
        createPostgresError({
          code: "ERR_POSTGRES_CONNECTION_CLOSED",
          message: "Connection closed",
        }),
      ),
    );

    expect(event.fields.slug).toBe("db-connection-unavailable");
  });

  it("does not read a deadlock on an upsert as a provider push conflict", async () => {
    const event = await runFailingJob(
      wrapInDrizzle(
        MAPPING_UPSERT_QUERY,
        createPostgresError({
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "40P01",
          message: "deadlock detected",
        }),
      ),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
  });

  it("does not read a unique violation on an upsert as a provider push conflict", async () => {
    const event = await runFailingJob(
      wrapInDrizzle(
        SYNC_STATUS_UPSERT_QUERY,
        createPostgresError({
          code: "ERR_POSTGRES_SERVER_ERROR",
          constraint: "sync_status_pkey",
          detail: "Key (calendar_id)=(calendar-1) already exists.",
          errno: "23505",
          message: "duplicate key value violates unique constraint \"sync_status_pkey\"",
        }),
      ),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
  });

  it("does not read a serialization failure on an upsert as a provider push conflict", async () => {
    const event = await runFailingJob(
      wrapInDrizzle(
        SYNC_STATUS_UPSERT_QUERY,
        createPostgresError({
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "40001",
          message: "could not serialize access due to concurrent update",
        }),
      ),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
  });

  it("does not read a check-constraint violation as a provider push conflict", async () => {
    const event = await runFailingJob(
      wrapInDrizzle(
        MAPPING_UPSERT_QUERY,
        createPostgresError({
          code: "ERR_POSTGRES_SERVER_ERROR",
          constraint: "calendars_sync_future_range_check",
          errno: "23514",
          message: "new row for relation \"calendars\" violates check constraint \"calendars_sync_future_range_check\"",
        }),
      ),
    );

    expect(PROVIDER_SLUGS.has(String(event.fields.slug))).toBe(false);
  });

  it("classifies a genuine provider conflict as a push conflict", async () => {
    const event = await runFailingJob(
      Object.assign(new Error("Precondition Failed"), { statusCode: 412 }),
    );

    expect(event.fields.slug).toBe("sync-push-conflict");
  });

  it("returns the same slug on every retry of one incident", async () => {
    const slugs: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      emitted.length = 0;
      const event = await runFailingJob(
        wrapInDrizzle(
          MAPPING_UPSERT_QUERY,
          createPostgresError({
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "40P01",
            message: "deadlock detected",
          }),
        ),
      );
      slugs.push(event.fields.slug);
    }

    expect(new Set(slugs).size).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  resetDatabasePoolTelemetry,
  withDatabasePoolWindow,
} from "@keeper.sh/database";
import { syncCalendar } from "@keeper.sh/calendar";
import type { MaterializedSyncableEvent } from "@keeper.sh/calendar";
import { createDestinationAttemptWideEventFields } from "../src/sync-user";

interface FakeClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  savepoint: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const ENGINE_PHASE_FIELDS = [
  "sync.phase.read_state.duration_ms",
  "sync.phase.currency_check.duration_ms",
  "sync.phase.compute_operations.duration_ms",
  "sync.phase.provider_push.duration_ms",
  "sync.phase.provider_delete.duration_ms",
  "sync.phase.checkpoint_flush.duration_ms",
  "sync.phase.mapping_flush.duration_ms",
] as const;

const ATTEMPT_PHASE_FIELDS = [
  "sync.phase.destination_lookup.duration_ms",
  "sync.phase.lock_acquire.duration_ms",
  "sync.phase.provider_resolve.duration_ms",
  "sync.phase.source_authority.duration_ms",
] as const;

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

// Bun hands `begin` a fresh client and `savepoint` the one it was called on.
const createClient = (statementDurationMs: number) => {
  const issued: string[] = [];
  const buildClient = (): FakeClient => {
    const client: FakeClient = {
      begin: async (callback) => await callback(buildClient()),
      savepoint: async (callback) => await callback(client),
      unsafe: (query: string): object => {
        issued.push(query);
        return delay(statementDurationMs).then(() => []);
      },
    };
    return client;
  };
  return { client: buildClient(), issued };
};

const makeLocalEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: `Event ${id}`,
});

const measurePhase = async <TResult>(
  run: () => Promise<TResult>,
): Promise<{ durationMs: number; value: TResult }> => {
  const startedAt = performance.now();
  const value = await run();
  return { durationMs: Math.round((performance.now() - startedAt) * 100) / 100, value };
};

interface AttemptOptions {
  eventIds: string[];
  flushFails?: boolean;
  skip?: boolean;
}

interface AttemptOutcome {
  fields: Record<string, number>;
  issuedDuringAttempt: number;
  syncEvent: Record<string, unknown> | null;
  threw: boolean;
}

const runAttempt = async (
  client: FakeClient,
  issued: string[],
  options: AttemptOptions,
): Promise<AttemptOutcome> => {
  const issuedBefore = issued.length;
  const attemptStartedAt = performance.now();
  return await withDatabasePoolWindow(async (readPoolWindow): Promise<AttemptOutcome> => {
    const lockAcquire = await measurePhase(async () => {
      await delay(1);
      return !options.skip;
    });
    if (!lockAcquire.value) {
      return {
        fields: createDestinationAttemptWideEventFields({
          attemptStartedAt,
          destinationLookupDurationMs: 0,
          lockAcquireDurationMs: lockAcquire.durationMs,
          providerResolveDurationMs: 0,
          readPoolWindow,
          sourceAuthorityDurationMs: 0,
        }),
        issuedDuringAttempt: issued.length - issuedBefore,
        syncEvent: null,
        threw: false,
      };
    }

    const destinationLookup = await measurePhase(
      async () => await (client.unsafe("select destination", []) as Promise<unknown>),
    );
    const providerResolve = await measurePhase(
      async () => await (client.unsafe("select account", []) as Promise<unknown>),
    );
    const sourceAuthority = await measurePhase(
      async () => await (client.unsafe("select coverage", []) as Promise<unknown>),
    );

    let syncEvent: Record<string, unknown> | null = null;
    let threw = false;
    try {
      await syncCalendar({
        calendarId: "dest-cal-1",
        flush: async () => {
          await client.begin(async (transaction) => {
            await (transaction.unsafe("insert mapping", []) as Promise<unknown>);
            await transaction.savepoint(async (nested) => {
              await (nested.unsafe("update checkpoint", []) as Promise<unknown>);
              if (options.flushFails) {
                throw new Error("flush rolled back");
              }
            });
          });
        },
        isCurrent: async () => {
          await (client.unsafe("select still current", []) as Promise<unknown>);
          return true;
        },
        onSyncEvent: (event) => {
          syncEvent = event as Record<string, unknown>;
        },
        provider: {
          deleteEvents: () => Promise.resolve([]),
          listRemoteEvents: () => Promise.resolve({ items: [], rawItemCount: 0 }),
          pushEvents: (events) =>
            Promise.resolve(
              events.map((event) => ({
                deleteIdentifier: `del-${event.id}`,
                eventId: event.id,
                remoteEventUid: `remote-${event.id}`,
                success: true as const,
              })),
            ),
        },
        readState: async () =>
          await (client.begin(async (transaction) => {
            await (transaction.unsafe("select local events", []) as Promise<unknown>);
            await (transaction.unsafe("select mappings", []) as Promise<unknown>);
            return {
              existingMappings: [],
              localEvents: options.eventIds.map((id) => makeLocalEvent(id)),
              remoteEvents: [],
              remoteRawItemCount: 0,
            };
          }) as Promise<{
            existingMappings: never[];
            localEvents: MaterializedSyncableEvent[];
            remoteEvents: never[];
            remoteRawItemCount: number;
          }>),
        reconciliationScope: RECONCILIATION_SCOPE,
        userId: "user-1",
      });
    } catch {
      threw = true;
    }

    const fields = createDestinationAttemptWideEventFields({
      attemptStartedAt,
      destinationLookupDurationMs: destinationLookup.durationMs,
      lockAcquireDurationMs: lockAcquire.durationMs,
      providerResolveDurationMs: providerResolve.durationMs,
      readPoolWindow,
      sourceAuthorityDurationMs: sourceAuthority.durationMs,
    });

    return {
      fields,
      issuedDuringAttempt: issued.length - issuedBefore,
      syncEvent,
      threw,
    };
  });
};

const sumEnginePhases = (event: Record<string, unknown>): number =>
  ENGINE_PHASE_FIELDS.reduce((total, field) => total + (event[field] as number), 0);

const sumAttemptPhases = (fields: Record<string, number>): number =>
  ATTEMPT_PHASE_FIELDS.reduce((total, field) => total + (fields[field] as number), 0);

describe("destination attempt telemetry composed with the sync engine", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("charges each sequential attempt exactly the statements it issued, repeatedly", async () => {
    const { client, issued } = createClient(1);
    instrumentDatabasePool(client, 10);

    const counts: number[] = [];
    for (let round = 0; round < 5; round++) {
      const outcome = await runAttempt(client, issued, { eventIds: ["a", "b"] });
      expect(outcome.threw).toBe(false);
      expect(outcome.fields["database.queries.count"]).toBe(outcome.issuedDuringAttempt);
      expect(outcome.fields["database.pool.in_flight"]).toBe(0);
      expect(outcome.fields["database.queries.failed_count"]).toBe(0);
      expect(outcome.fields["database.queries.queued_count"]).toBe(0);
      counts.push(outcome.fields["database.queries.count"] as number);
    }

    expect(new Set(counts).size, `counts drifted: ${counts.join(",")}`).toBe(1);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it("keeps the attempt total above the reconcile total and every phase it names", async () => {
    const { client, issued } = createClient(2);
    instrumentDatabasePool(client, 10);

    for (let round = 0; round < 3; round++) {
      const outcome = await runAttempt(client, issued, { eventIds: ["a"] });
      const syncEvent = outcome.syncEvent as Record<string, unknown> | null;
      expect(syncEvent).not.toBeNull();
      const attemptDurationMs = outcome.fields["sync.attempt.duration_ms"] as number;
      const reconcileDurationMs = (syncEvent as Record<string, unknown>)[
        "sync.reconcile.duration_ms"
      ] as number;

      expect(attemptDurationMs).toBeGreaterThanOrEqual(reconcileDurationMs);
      expect(attemptDurationMs + 1).toBeGreaterThanOrEqual(
        reconcileDurationMs + sumAttemptPhases(outcome.fields),
      );
      expect(
        sumEnginePhases(syncEvent as Record<string, unknown>)
          + ((syncEvent as Record<string, unknown>)[
            "sync.phase.unattributed.duration_ms"
          ] as number),
      ).toBeCloseTo(reconcileDurationMs, 1);
    }
  });

  it("never reports more database time than the attempt that reports it lasted", async () => {
    const { client, issued } = createClient(3);
    instrumentDatabasePool(client, 10);

    for (let round = 0; round < 3; round++) {
      const outcome = await runAttempt(client, issued, { eventIds: ["a", "b", "c"] });
      expect(outcome.fields["database.queries.duration_ms"] as number).toBeLessThanOrEqual(
        outcome.fields["sync.attempt.duration_ms"] as number,
      );
    }
  });

  it("reports an empty window for a skipped attempt without disturbing the next", async () => {
    const { client, issued } = createClient(1);
    instrumentDatabasePool(client, 10);

    const first = await runAttempt(client, issued, { eventIds: ["a"] });
    const skipped = await runAttempt(client, issued, { eventIds: [], skip: true });
    const second = await runAttempt(client, issued, { eventIds: ["a"] });

    expect(skipped.issuedDuringAttempt).toBe(0);
    expect(skipped.fields["database.queries.count"]).toBe(0);
    expect(skipped.fields["database.queries.duration_ms"]).toBe(0);
    expect(skipped.fields["database.pool.in_flight"]).toBe(0);
    expect(second.fields["database.queries.count"]).toBe(second.issuedDuringAttempt);
    expect(second.fields["database.queries.count"]).toBe(first.fields["database.queries.count"]);
  });

  it("converges after an attempt whose flush transaction rolls back", async () => {
    const { client, issued } = createClient(1);
    instrumentDatabasePool(client, 10);

    const failed = await runAttempt(client, issued, { eventIds: ["a"], flushFails: true });
    expect(failed.fields["database.queries.count"]).toBe(failed.issuedDuringAttempt);
    expect(failed.fields["database.pool.in_flight"]).toBe(0);

    for (let round = 0; round < 3; round++) {
      const healthy = await runAttempt(client, issued, { eventIds: ["a"] });
      expect(healthy.threw).toBe(false);
      expect(healthy.fields["database.pool.in_flight"]).toBe(0);
      expect(healthy.fields["database.queries.queued_count"]).toBe(0);
      expect(healthy.fields["database.queries.count"]).toBe(healthy.issuedDuringAttempt);
    }
  });

  it("holds its counts flat over fifty attempts and leaves no in-flight residue", async () => {
    const { client, issued } = createClient(0);
    instrumentDatabasePool(client, 10);

    const counts = new Set<number>();
    for (let round = 0; round < 50; round++) {
      const outcome = await runAttempt(client, issued, { eventIds: ["a"] });
      counts.add(outcome.fields["database.queries.count"] as number);
      expect(outcome.fields["database.pool.in_flight"]).toBe(0);
      expect(outcome.fields["database.queries.queued_count"]).toBe(0);
    }

    expect(counts.size, `counts drifted: ${[...counts].join(",")}`).toBe(1);

    // Tightening the pool to one connection turns any leaked occupancy into queued demand.
    instrumentDatabasePool(client, 1);
    const probe = await runAttempt(client, issued, { eventIds: ["a"] });
    expect(probe.threw).toBe(false);
    expect(probe.fields["database.queries.queued_count"]).toBe(0);
    expect(probe.fields["database.pool.in_flight"]).toBe(0);
    expect(probe.fields["database.queries.count"]).toBe(probe.issuedDuringAttempt);
  });

  it("emits only finite non-negative numbers on every field of every attempt", async () => {
    const { client, issued } = createClient(1);
    instrumentDatabasePool(client, 10);

    const outcome = await runAttempt(client, issued, { eventIds: ["a"] });
    for (const [field, value] of Object.entries(outcome.fields)) {
      expect(typeof value, `${field} is a number`).toBe("number");
      expect(Number.isFinite(value), `${field} is finite`).toBe(true);
      expect(value, `${field} is not negative`).toBeGreaterThanOrEqual(0);
    }
    for (const field of ENGINE_PHASE_FIELDS) {
      const value = (outcome.syncEvent as Record<string, unknown>)[field] as number;
      expect(Number.isFinite(value), `${field} is finite`).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

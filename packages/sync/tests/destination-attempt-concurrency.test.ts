import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  resetDatabasePoolTelemetry,
  withDatabasePoolWindow,
} from "@keeper.sh/database";
import { createDestinationAttemptWideEventFields } from "../src/sync-user";

interface FakeClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, durationMs); });

const createSlowClient = (statementDurationMs: number): FakeClient => {
  const buildClient = (): FakeClient => ({
    begin: async (callback: (transactionClient: FakeClient) => Promise<unknown>) =>
      await callback(buildClient()),
    unsafe: (): object => delay(statementDurationMs).then(() => []),
  });
  return buildClient();
};

const runAttempt = async (
  client: FakeClient,
  statementCount: number,
): Promise<Record<string, number>> => {
  const attemptStartedAt = performance.now();
  return await withDatabasePoolWindow(async (readPoolWindow) => {
    for (let statement = 0; statement < statementCount; statement++) {
      await client.unsafe("select 1", []);
    }
    return createDestinationAttemptWideEventFields({
      attemptStartedAt,
      destinationLookupDurationMs: 0,
      lockAcquireDurationMs: 0,
      providerResolveDurationMs: 0,
      readPoolWindow,
      sourceAuthorityDurationMs: 0,
    });
  });
};

describe("destination attempt pool fields under worker concurrency", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts only the queries the attempt itself issued", async () => {
    const client = createSlowClient(20);
    instrumentDatabasePool(client, 10);

    const [first, second] = await Promise.all([
      runAttempt(client, 3),
      runAttempt(client, 3),
    ]);

    expect(first?.["database.queries.count"]).toBe(3);
    expect(second?.["database.queries.count"]).toBe(3);
  });

  it("never reports more query time than the attempt itself lasted", async () => {
    const client = createSlowClient(20);
    instrumentDatabasePool(client, 10);

    const attempts = await Promise.all([
      runAttempt(client, 3),
      runAttempt(client, 3),
      runAttempt(client, 3),
    ]);

    for (const attempt of attempts) {
      expect(attempt["database.queries.duration_ms"]).toBeLessThanOrEqual(
        attempt["sync.attempt.duration_ms"] as number,
      );
    }
  });

  it("converges: a solitary attempt reports the same fields on every repetition", async () => {
    const client = createSlowClient(1);
    instrumentDatabasePool(client, 10);

    const counts: number[] = [];
    for (let round = 0; round < 10; round++) {
      const attempt = await runAttempt(client, 4);
      counts.push(attempt["database.queries.count"] as number);
      expect(attempt["database.pool.in_flight"]).toBe(0);
      expect(attempt["database.queries.queued_count"]).toBe(0);
      expect(attempt["database.queries.failed_count"]).toBe(0);
    }
    expect(counts).toEqual(Array.from({ length: 10 }, () => 4));
  });
});

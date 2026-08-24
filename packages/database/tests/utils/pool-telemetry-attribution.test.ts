import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

interface FakeClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const createSlowClient = (statementDurationMs: number): FakeClient => {
  const buildClient = (): FakeClient => ({
    begin: async (callback: (transactionClient: FakeClient) => Promise<unknown>) =>
      await callback(buildClient()),
    unsafe: (): object => delay(statementDurationMs).then(() => []),
  });
  return buildClient();
};

// A deferred callback runs in the releaser's async context, not the opener's.
const createHandOffClient = () => {
  const waiting: (() => void)[] = [];
  const buildClient = (): FakeClient => ({
    begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        waiting.push(() => {
          Promise.resolve(callback(buildClient())).then(resolve).catch(reject);
        });
      }),
    unsafe: (): object => Promise.resolve([]),
  });
  return { client: buildClient(), waiting };
};

const runUnitOfWork = async (
  client: FakeClient,
  statementCount: number,
): Promise<{ queryCount: number; queryDurationMs: number; wallMs: number }> => {
  const startedAt = performance.now();
  return await withDatabasePoolWindow(async (readWindow) => {
    for (let statement = 0; statement < statementCount; statement++) {
      await (client.unsafe("select 1", []) as Promise<unknown>);
    }
    const sample = readWindow();
    return {
      queryCount: sample.queryCount,
      queryDurationMs: sample.queryDurationMs,
      wallMs: performance.now() - startedAt,
    };
  });
};

describe("database pool telemetry attribution across concurrent work", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("charges each concurrent unit of work only for the queries it issued", async () => {
    const client = createSlowClient(20);
    instrumentDatabasePool(client, 10);

    const units = await Promise.all([
      runUnitOfWork(client, 3),
      runUnitOfWork(client, 3),
      runUnitOfWork(client, 3),
    ]);

    for (const unit of units) {
      expect(unit.queryCount).toBe(3);
      expect(unit.queryDurationMs).toBeLessThanOrEqual(unit.wallMs);
    }
  });

  it("charges a transaction the pool granted late to the window that opened it", async () => {
    const { client, waiting } = createHandOffClient();
    instrumentDatabasePool(client, 1);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const blocked = client.begin(async (transaction) => {
        await (transaction.unsafe("select 1", []) as Promise<unknown>);
        await (transaction.unsafe("select 2", []) as Promise<unknown>);
      });

      const releaseFromAnotherContext = async (): Promise<void> => {
        await withDatabasePoolWindow(async (unrelated): Promise<void> => {
          while (waiting.length === 0) {
            await delay(1);
          }
          waiting.shift()?.();
          await blocked;
          expect(unrelated().queryCount).toBe(0);
        });
      };

      await releaseFromAnotherContext();

      const sample = readWindow();
      expect(sample.queryCount).toBe(2);
      expect(sample.inFlight).toBe(0);
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

interface FakeClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  savepoint: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const createClient = (statementDurationMs = 0): FakeClient => {
  const buildClient = (): FakeClient => {
    const client: FakeClient = {
      begin: async (callback) => await callback(buildClient()),
      savepoint: async function savepoint(callback) {
        return await callback(client);
      },
      unsafe: (): object => {
        if (statementDurationMs === 0) {
          return Promise.resolve([]);
        }
        return delay(statementDurationMs).then(() => []);
      },
    };
    return client;
  };
  return buildClient();
};

const runQuery = async (client: FakeClient): Promise<void> => {
  await (client.unsafe("select 1", []) as Promise<unknown>);
};

describe("database pool telemetry window context boundaries", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("keeps a caller's window from absorbing a nested unit of work's queries", async () => {
    const client = createClient();
    instrumentDatabasePool(client, 10);

    const nested = async (): Promise<number> => {
      await delay(1);
      return await withDatabasePoolWindow(async (readWindow) => {
        await runQuery(client);
        await runQuery(client);
        return readWindow().queryCount;
      });
    };

    await withDatabasePoolWindow(async (outerWindow): Promise<void> => {
      await runQuery(client);
      const nestedCount = await nested();
      await runQuery(client);

      expect(nestedCount).toBe(2);
      expect(outerWindow().queryCount).toBe(2);
    });
  });

  it("stops charging a window once the body it was opened around has returned", async () => {
    const client = createClient();
    instrumentDatabasePool(client, 10);

    const readWindow = await withDatabasePoolWindow(async (read) => {
      await runQuery(client);
      return read;
    });

    await runQuery(client);
    await runQuery(client);

    expect(readWindow().queryCount).toBe(1);
  });

  it("does not charge a window for work that was already scheduled when it opened", async () => {
    const client = createClient();
    instrumentDatabasePool(client, 10);

    const pending = delay(5).then(() => runQuery(client));
    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await runQuery(client);
      await pending;

      expect(readWindow().queryCount).toBe(1);
    });
  });

  it("charges every attempt of every concurrent job only its own queries, repeatedly", async () => {
    const client = createClient(1);
    instrumentDatabasePool(client, 10);

    const runAttempt = async (statementCount: number): Promise<number> =>
      await withDatabasePoolWindow(async (readWindow) => {
        await client.begin(async (transactionClient) => {
          for (let statement = 0; statement < statementCount; statement++) {
            await runQuery(transactionClient as FakeClient);
          }
          return null;
        });
        return readWindow().queryCount;
      });

    const runJob = async (job: number): Promise<number[]> => {
      const counts: number[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        counts.push(await runAttempt(job + attempt));
      }
      return counts;
    };

    for (let round = 0; round < 5; round++) {
      const jobs = await Promise.all([runJob(1), runJob(2), runJob(3), runJob(4)]);
      expect(jobs).toEqual([
        [2, 3, 4],
        [3, 4, 5],
        [4, 5, 6],
        [5, 6, 7],
      ]);
    }
  });

  it("keeps windows nobody reads from bleeding into the next window", async () => {
    const client = createClient();
    instrumentDatabasePool(client, 10);

    for (let abandoned = 0; abandoned < 20; abandoned++) {
      await withDatabasePoolWindow(async (): Promise<void> => {
        await runQuery(client);
      });
    }

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await runQuery(client);

      expect(readWindow()).toEqual({
        failedQueryCount: 0,
        inFlight: 0,
        queryCount: 1,
        queryDurationMs: expect.any(Number),
        queuedQueryCount: 0,
      });
    });
  });

  it("charges a savepoint's statements to the window that opened the transaction", async () => {
    const client = createClient();
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await client.begin(async (transactionClient) => {
        await runQuery(transactionClient as FakeClient);
        await (transactionClient as FakeClient).savepoint(async (savepointClient) => {
          await runQuery(savepointClient as FakeClient);
          return null;
        });
        return null;
      });

      expect(readWindow().queryCount).toBe(2);
    });
  });

  it("returns process in-flight to zero after interleaved jobs and reports no residual queueing", async () => {
    const client = createClient(2);
    instrumentDatabasePool(client, 2);

    const busy = async (): Promise<void> => {
      await client.begin(async (transactionClient) => {
        await runQuery(transactionClient as FakeClient);
        return null;
      });
    };

    for (let round = 0; round < 4; round++) {
      await Promise.all(Array.from({ length: 8 }, () => busy()));
    }

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await runQuery(client);
      const sample = readWindow();

      expect(sample.inFlight).toBe(0);
      expect(sample.queuedQueryCount).toBe(0);
      expect(sample.queryCount).toBe(1);
    });
  });
});

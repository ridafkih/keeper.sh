import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

interface FakeQuery extends PromiseLike<unknown> {
  catch: (onRejected?: (error: unknown) => unknown) => Promise<unknown>;
  finally: (onFinally?: () => unknown) => Promise<unknown>;
}

const createFakeClient = () => {
  const pending: PromiseWithResolvers<unknown[]>[] = [];
  const client = {
    unsafe: (_statement: string): object => {
      const deferred = Promise.withResolvers<unknown[]>();
      pending.push(deferred);
      return deferred.promise;
    },
  };
  return { client, pending };
};

describe("database pool telemetry for queries that are never awaited", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("leaves the gauges untouched by a query that is constructed but never awaited", () => {
    const { client } = createFakeClient();
    instrumentDatabasePool(client, 2);

    withDatabasePoolWindow((readWindow): void => {
      for (let index = 0; index < 10; index += 1) {
        client.unsafe("select 1");
      }

      const sample = readWindow();
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(0);
    });
  });

  it("does not report a later query on an idle pool as queued after unawaited queries", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      for (let index = 0; index < 10; index += 1) {
        client.unsafe("select 1");
      }

      const query = client.unsafe("select 1") as FakeQuery;
      const awaited = query.then((result) => result);
      pending.at(-1)?.resolve([]);
      await awaited;

      const sample = readWindow();
      expect(sample.queuedQueryCount).toBe(0);
      expect(sample.queryCount).toBe(1);
      expect(sample.inFlight).toBe(0);
    });
  });

  it("counts an awaited query exactly once across then, catch and finally", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const query = client.unsafe("select 1") as FakeQuery;
      const viaThen = query.then((result) => result);
      const viaCatch = query.catch(() => null);
      const viaFinally = query.finally(() => null);

      expect(readWindow().inFlight).toBe(1);
      expect(readWindow().queryCount).toBe(1);

      pending[0]?.resolve([]);
      await Promise.all([viaThen, viaCatch, viaFinally]);

      const sample = readWindow();
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(1);
      expect(sample.failedQueryCount).toBe(0);
    });
  });

  it("counts a rejected query exactly once across repeated settlement handlers", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const query = client.unsafe("select 1") as FakeQuery;
      const first = query.catch(() => "handled");
      const second = query.catch(() => "handled");

      pending[0]?.reject(new Error("connection closed"));
      expect(await first).toBe("handled");
      expect(await second).toBe("handled");

      const sample = readWindow();
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(1);
      expect(sample.failedQueryCount).toBe(1);
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const createFakeClient = () => {
  const pending: PromiseWithResolvers<unknown[]>[] = [];
  const client = {
    unsafe: (): object => {
      const deferred = Promise.withResolvers<unknown[]>();
      pending.push(deferred);
      return deferred.promise;
    },
  };
  return { client, pending };
};

const settleAfter = async (
  deferred: PromiseWithResolvers<unknown[]> | undefined,
  durationMs: number,
): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
  deferred?.resolve([]);
};

describe("database pool telemetry window boundaries", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("does not charge a window for a query that was issued before it opened", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 10);

    const early = client.unsafe() as PromiseLike<unknown>;
    await withDatabasePoolWindow(async (window): Promise<void> => {
      await settleAfter(pending[0], 25);
      await early;

      const sample = window();

      expect(sample.queryCount).toBe(0);
      expect(sample.queryDurationMs).toBe(0);
    });
  });

  it("does not report a failure the window never counted a query for", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 10);

    const early = client.unsafe() as PromiseLike<unknown>;
    await withDatabasePoolWindow(async (window): Promise<void> => {
      pending[0]?.reject(new Error("connection terminated"));
      await expect(early).rejects.toThrow("connection terminated");

      const sample = window();

      expect(sample.queryCount).toBe(0);
      expect(sample.failedQueryCount).toBe(0);
    });
  });

  it("reports an unsettled query as counted with no duration yet", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (window): Promise<void> => {
      const inflight = (client.unsafe() as PromiseLike<unknown>).then((result) => result);
      const sample = window();

      expect(sample.queryCount).toBe(1);
      expect(sample.queryDurationMs).toBe(0);
      expect(sample.inFlight).toBe(1);

      pending[0]?.resolve([]);
      await inflight;
      expect(window().inFlight).toBe(0);
    });
  });

  it("keeps repeated identical windows on the same client identical", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 10);

    const samples: string[] = [];
    for (let round = 0; round < 5; round += 1) {
      await withDatabasePoolWindow(async (window): Promise<void> => {
        const query = client.unsafe() as PromiseLike<unknown>;
        pending[round]?.resolve([]);
        await query;
        const sample = window();
        samples.push([
          sample.queryCount,
          sample.failedQueryCount,
          sample.queuedQueryCount,
          sample.inFlight,
        ].join("/"));
      });
    }

    expect(new Set(samples).size).toBe(1);
    expect(samples[0]).toBe("1/0/0/0");
  });

  it("stays inert when a pool is instrumented twice", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 10);
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (window): Promise<void> => {
      const query = client.unsafe() as PromiseLike<unknown>;
      pending[0]?.resolve([]);
      await query;
      const sample = window();

      expect(sample.queryCount).toBe(1);
      expect(sample.inFlight).toBe(0);
    });
  });
});

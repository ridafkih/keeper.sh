import { beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

interface ThenableClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: ThenableClient) => Promise<unknown>) => PromiseLike<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const createThenableClient = (): ThenableClient => ({
  begin: (callback) => {
    const settled = (async () => await callback(createThenableClient()))();
    return {
      // eslint-disable-next-line unicorn/no-thenable -- the fixture is a non-native thenable by construction
      then: <TResult1 = unknown, TResult2 = never>(
        onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        // eslint-disable-next-line promise/prefer-catch -- forwarding both handlers is the thenable contract under test
      ): PromiseLike<TResult1 | TResult2> => settled.then(onFulfilled, onRejected),
    };
  },
  unsafe: (): object => Promise.resolve([]),
});

describe("database pool telemetry with a thenable transaction result", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("keeps an unawaited thenable transaction rejection observable to the process", async () => {
    const script = `
      import { instrumentDatabasePool } from ${JSON.stringify(new URL("../../src/utils/pool-telemetry.ts", import.meta.url).pathname)};

      const buildClient = () => ({
        begin: (callback) => {
          const settled = (async () => await callback(buildClient()))();
          return { then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected) };
        },
        unsafe: () => Promise.resolve([]),
      });

      const client = buildClient();
      if (process.argv[2] === "instrumented") {
        instrumentDatabasePool(client, 2);
      }

      let seen = 0;
      process.on("unhandledRejection", () => { seen += 1; });
      void client.begin(async () => { throw new Error("boom"); });
      await Bun.sleep(50);
      console.log(String(seen));
    `;
    const scriptPath = `${tmpdir()}/pool-telemetry-thenable-${process.pid}.probe.ts`;
    await Bun.write(scriptPath, script);

    const run = async (mode: string): Promise<string> => {
      const proc = Bun.spawn(["bun", scriptPath, mode], { stdout: "pipe", stderr: "pipe" });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      return output.trim();
    };

    const baseline = await run("baseline");
    const instrumented = await run("instrumented");

    expect(baseline).toBe("1");
    expect(instrumented).toBe(baseline);
  });

  it("releases the acquisition of a thenable transaction so demand does not ratchet", async () => {
    const client = createThenableClient();
    instrumentDatabasePool(client, 2);

    for (let round = 0; round < 6; round++) {
      await client.begin(async (transactionClient) => {
        await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
      });
    }

    await withDatabasePoolWindow(async (window): Promise<void> => {
      await (client.unsafe("select 1", []) as Promise<unknown>);
      const sample = window();

      expect(sample.queuedQueryCount).toBe(0);
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(1);
    });
  });

  it("keeps a transaction that runs no statement from ratcheting demand", async () => {
    const client = createThenableClient();
    instrumentDatabasePool(client, 2);

    for (let round = 0; round < 6; round++) {
      await client.begin(() => Promise.resolve(null));
    }

    await withDatabasePoolWindow(async (window): Promise<void> => {
      await (client.unsafe("select 1", []) as Promise<unknown>);
      const sample = window();

      expect(sample.queuedQueryCount).toBe(0);
      expect(sample.inFlight).toBe(0);
    });
  });
});

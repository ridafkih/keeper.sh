import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";
import {
  deletePolarCustomerByExternalId,
  POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
} from "../src/polar-customer-delete";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

describe("deletePolarCustomerByExternalId", () => {
  it("ignores ResourceNotFound responses from Polar", async () => {
    const resourceNotFoundError = Object.assign(new Error("Not found"), {
      detail: "Not found",
      error: "ResourceNotFound",
    });
    const deleteExternal = vi.fn(() => Promise.reject(resourceNotFoundError));

    await expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).resolves.toBeUndefined();

    expect(deleteExternal).toHaveBeenCalledTimes(1);
    expect(deleteExternal).toHaveBeenCalledWith(
      { externalId: "user-1" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeoutMs: POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
      }),
    );
  });

  it("propagates an unexpected Polar failure instead of orphaning the customer", async () => {
    const deleteExternal = vi.fn(() => Promise.reject(new Error("polar unavailable")));

    await expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).rejects.toThrow("polar unavailable");
  });

  it("reports an unexpected failure by rejecting rather than by writing to stderr", async () => {
    const deleteExternal = vi.fn(() => Promise.reject(new Error("polar unavailable")));
    const stderrWrite = vi.fn(() => true);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.env.NODE_ENV = "production";
    process.stderr.write = stderrWrite;

    try {
      await expect(
        deletePolarCustomerByExternalId(
          { customers: { deleteExternal } },
          "user-1",
        ),
      ).rejects.toThrow("polar unavailable");

      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.stderr.write = originalStderrWrite;
    }
  });
});


const stubDatabase = {} as BunSQLDatabase;

const BLACK_HOLE_OBSERVATION_MS = 8000;
const SETTLEMENT_TEST_TIMEOUT_MS = 30_000;

const buildPolarAuth = () =>
  createAuth({
    baseUrl: "http://localhost:3000",
    database: stubDatabase,
    deleteUserTeardown: async () => {},
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardownRollback: async () => {},
    polarAccessToken: "polar-test-token",
    polarMode: "sandbox",
    secret: "test-secret",
  } as Parameters<typeof createAuth>[0]);

const resolvePolarClient = () => {
  const { polarClient } = buildPolarAuth();

  if (!polarClient) {
    throw new TypeError("createAuth did not build a Polar client");
  }

  return polarClient;
};

const PENDING = Symbol("pending");

const settle = async <TValue>(promise: Promise<TValue>) => {
  try {
    await promise;
    return { state: "fulfilled" as const };
  } catch (error) {
    return { error, state: "rejected" as const };
  }
};

const describeSettlement = async <TValue>(
  promise: Promise<TValue>,
  waitMs: number,
) => {
  const started = Date.now();
  const timer = new Promise<typeof PENDING>((resolve) => {
    setTimeout(() => resolve(PENDING), waitMs);
  });

  const outcome = await Promise.race([settle(promise), timer]);

  if (outcome === PENDING) {
    return { elapsedMs: Date.now() - started, state: "pending" as const };
  }

  return { ...outcome, elapsedMs: Date.now() - started };
};

const toRequest = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) => {
  if (input instanceof Request) {
    return input;
  }
  return new Request(String(input), init);
};

describe("Polar client deadlines", () => {
  const originalFetch = globalThis.fetch;
  const blackHoleControllers: AbortController[] = [];

  const installBlackHoleFetch = () => {
    globalThis.fetch = ((
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      const request = toRequest(input, init);
      const controller = new AbortController();
      blackHoleControllers.push(controller);

      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          reject(request.signal.reason ?? new Error("black hole aborted"));
        };

        if (request.signal.aborted) {
          abort();
          return;
        }

        request.signal.addEventListener("abort", abort, { once: true });
        controller.signal.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch;
  };

  afterEach(() => {
    for (const controller of blackHoleControllers) {
      controller.abort(new Error("test teardown"));
    }
    blackHoleControllers.length = 0;
    globalThis.fetch = originalFetch;
  });

  it(
    "imposes no client-side deadline on checkout creation",
    async () => {
      installBlackHoleFetch();
      const polarClient = resolvePolarClient();

      const outcome = await describeSettlement(
        polarClient.checkouts.create({ products: ["product-1"] }),
        BLACK_HOLE_OBSERVATION_MS,
      );

      expect(outcome).toMatchObject({ state: "pending" });
    },
    SETTLEMENT_TEST_TIMEOUT_MS,
  );

  it(
    "imposes no client-side deadline on the sign-up customer lookup",
    async () => {
      installBlackHoleFetch();
      const polarClient = resolvePolarClient();

      const outcome = await describeSettlement(
        polarClient.customers.list({ email: "customer@example.com" }),
        BLACK_HOLE_OBSERVATION_MS,
      );

      expect(outcome).toMatchObject({ state: "pending" });
    },
    SETTLEMENT_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a deadline on the teardown deletion call",
    async () => {
      installBlackHoleFetch();
      const polarClient = resolvePolarClient();

      const outcome = await describeSettlement(
        deletePolarCustomerByExternalId(polarClient, "user-1"),
        BLACK_HOLE_OBSERVATION_MS,
      );

      expect(outcome.state).toBe("rejected");
      expect(outcome.elapsedMs).toBeLessThan(BLACK_HOLE_OBSERVATION_MS);
    },
    SETTLEMENT_TEST_TIMEOUT_MS,
  );
});

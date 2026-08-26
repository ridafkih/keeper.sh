import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widelog, widelogger } from "widelogger";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const stubDatabase = {} as BunSQLDatabase;

const POLAR_TEARDOWN_BOUND_MS = 10_000;

const buildAuth = (overrides: Record<string, unknown> = {}) =>
  createAuth({
    baseUrl: "http://localhost:3000",
    database: stubDatabase,
    polarAccessToken: "polar-test-token",
    polarMode: "sandbox",
    secret: "test-secret",
    ...overrides,
  } as Parameters<typeof createAuth>[0]);

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "auth-test",
});

const emitted: Record<string, unknown>[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line));
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const NO_REQUEST = Object.freeze({}) as never;

const resolveBeforeDelete = (auth: ReturnType<typeof createAuth>["auth"]) => {
  const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;

  if (typeof beforeDelete !== "function") {
    throw new TypeError("deleteUser.beforeDelete is not wired");
  }

  return (user: { id: string }) => beforeDelete(user as never, NO_REQUEST);
};

const resolveAfterDelete = (auth: ReturnType<typeof createAuth>["auth"]) => {
  const afterDelete = auth.options.user?.deleteUser?.afterDelete;

  if (typeof afterDelete !== "function") {
    throw new TypeError("deleteUser.afterDelete is not wired");
  }

  return (user: { id: string }) => afterDelete(user as never, NO_REQUEST);
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const createHang = () => {
  const resolvers: (() => void)[] = [];
  const promise = new Promise<void>((resolve) => {
    resolvers.push(() => {
      resolve();
    });
  });
  const [release] = resolvers;

  if (!release) {
    throw new TypeError("hang promise did not expose its resolver");
  }

  return { promise, release };
};

const waitUntil = async (predicate: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await delay(10);
  }

  return predicate();
};

const readTeardownFields = (event: Record<string, unknown> | undefined, step: string) => {
  if (!event) {
    throw new TypeError("no wide event was emitted");
  }

  const teardown = event.delete_user_teardown;

  if (typeof teardown !== "object" || teardown === null) {
    throw new TypeError(
      `wide event carries no delete_user_teardown fields: ${JSON.stringify(event)}`,
    );
  }

  const fields = (teardown as Record<string, unknown>)[step];

  if (typeof fields !== "object" || fields === null) {
    throw new TypeError(
      `wide event carries no delete_user_teardown.${step} fields: ${JSON.stringify(event)}`,
    );
  }

  return fields as Record<string, unknown>;
};

const pointPolarAt = (
  polarClient: NonNullable<ReturnType<typeof createAuth>["polarClient"]>,
  serverURL: string,
) => {
  const options = (polarClient as unknown as { _options: Record<string, unknown> })._options;
  options.serverURL = serverURL;
  Reflect.deleteProperty(polarClient as unknown as Record<string, unknown>, "_customers");
};

describe("teardown ordering around the billing call", () => {
  it("stops sync before the row goes and bills out only after it is gone", async () => {
    const deleteUserTeardown = vi.fn(() => Promise.resolve());
    const { auth, polarClient } = buildAuth({ deleteUserTeardown });

    if (!polarClient) {
      throw new TypeError("polar client is not wired");
    }

    const { promise: polarHang, release: releasePolar } = createHang();

    const deleteExternal = vi.fn(() => polarHang);

    Object.defineProperty(polarClient, "customers", {
      configurable: true,
      value: { deleteExternal },
    });

    await resolveBeforeDelete(auth)({ id: "user-1" });

    expect(deleteUserTeardown).toHaveBeenCalledWith("user-1");
    expect(deleteExternal).not.toHaveBeenCalled();

    const pendingDelete = resolveAfterDelete(auth)({ id: "user-1" });

    const polarRan = await waitUntil(() => deleteExternal.mock.calls.length > 0, 1000);

    releasePolar();
    await pendingDelete;

    expect(polarRan).toBe(true);
  });
});

describe("boundedness of the Polar teardown call", () => {
  it("settles the teardown when Polar accepts the connection and never answers", async () => {
    let acceptedConnections = 0;
    let receivedChunks = 0;
    let socketErrors = 0;
    const blackHole = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data: () => {
          receivedChunks += 1;
        },
        error: () => {
          socketErrors += 1;
        },
        open: () => {
          acceptedConnections += 1;
        },
      },
    });

    const deleteUserTeardown = vi.fn(() => Promise.resolve());
    const { auth, polarClient } = buildAuth({ deleteUserTeardown });

    if (!polarClient) {
      throw new TypeError("polar client is not wired");
    }

    pointPolarAt(polarClient, `http://127.0.0.1:${blackHole.port}`);

    const afterDelete = resolveAfterDelete(auth);

    try {
      await context(async () => {
        const outcome = await Promise.race([
          afterDelete({ id: "user-1" }).then(() => "settled" as const),
          delay(POLAR_TEARDOWN_BOUND_MS).then(() => "still-hanging" as const),
        ]);

        expect(acceptedConnections).toBeGreaterThan(0);
        expect(receivedChunks).toBeGreaterThan(0);
        expect(socketErrors).toBe(0);
        expect(outcome).toBe("settled");

        widelog.flush();
      });

      expect(emitted).toHaveLength(1);

      const fields = readTeardownFields(emitted[0], "polar_customer");

      expect(fields.slug).toBe("delete-user-teardown-failed");
    } finally {
      blackHole.stop(true);
    }
  }, 30_000);
});

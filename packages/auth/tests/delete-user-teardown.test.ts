import { describe, expect, it, vi } from "vitest";
import { widelog, widelogger } from "widelogger";
import { createDeleteUserTeardown } from "../src/delete-user-teardown";
import { createAuth } from "../src/index";
import { deletePolarCustomerByExternalId } from "../src/polar-customer-delete";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const buildAuth = (overrides: Record<string, unknown> = {}) =>
  createAuth({
    baseUrl: "http://localhost:3000",
    database: {} as BunSQLDatabase,
    deleteUserTeardown: async () => {},
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardownRollback: async () => {},
    secret: "test-secret",
    ...overrides,
  } as Parameters<typeof createAuth>[0]);

const captureWideEvents = async (run: () => Promise<void>) => {
  const { context } = widelogger({
    defaultEventName: "wide_event",
    environment: "production",
    service: "auth-test",
  });
  const emitted: unknown[] = [];
  const parsedErrorMessages: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line));
      }
    }
    return true;
  }) as typeof process.stdout.write;

  try {
    await context(async () => {
      widelog.errors((error) => {
        parsedErrorMessages.push((error as { message?: string }).message ?? String(error));
        return "delete-user-teardown-failed";
      });

      await run();

      widelog.flush();
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  return { emitted, parsedErrorMessages };
};

const resolveBeforeDelete = (auth: ReturnType<typeof createAuth>["auth"]) => {
  const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;

  if (typeof beforeDelete !== "function") {
    throw new TypeError("deleteUser.beforeDelete is not wired");
  }

  return (user: { id: string }) => beforeDelete(user as never, Object.freeze({}) as never);
};

const resolveAfterDelete = (auth: ReturnType<typeof createAuth>["auth"]) => {
  const afterDelete = auth.options.user?.deleteUser?.afterDelete;

  if (typeof afterDelete !== "function") {
    throw new TypeError("deleteUser.afterDelete is not wired");
  }

  return (user: { id: string }) => afterDelete(user as never, Object.freeze({}) as never);
};

const TEARDOWN_FAILURE_MESSAGE = "push channel deregistration unavailable";

describe("account deletion teardown", () => {
  it("runs teardown as beforeDelete, while the cascade-deleted calendar, channel, and credential rows still exist", () => {
    const { auth } = buildAuth();

    expect(auth.options.user?.deleteUser?.beforeDelete).toBeTypeOf("function");
  });

  it("finishes teardown for the deleted user id before the row is removed", async () => {
    const sequence: string[] = [];
    const deleteUserTeardown = vi.fn(async (userId: string) => {
      sequence.push(`teardown:started:${userId}`);
      await Promise.resolve();
      sequence.push("teardown:finished");
    });
    const internalAdapter = {
      deleteUser: (userId: string) => {
        sequence.push(`internalAdapter.deleteUser:${userId}`);
        return Promise.resolve();
      },
    };

    const { auth } = buildAuth({ deleteUserTeardown });

    await resolveBeforeDelete(auth)({ id: "user-1" });
    await internalAdapter.deleteUser("user-1");

    expect(deleteUserTeardown).toHaveBeenCalledWith("user-1");
    expect(sequence).toEqual([
      "teardown:started:user-1",
      "teardown:finished",
      "internalAdapter.deleteUser:user-1",
    ]);
  });

  it("records a teardown failure on the active wide event and still deletes the user", async () => {
    const deleteUserTeardown = vi.fn(() =>
      Promise.reject(new Error(TEARDOWN_FAILURE_MESSAGE)),
    );
    const { auth } = buildAuth({ deleteUserTeardown });
    const beforeDelete = resolveBeforeDelete(auth);

    let deleted = false;

    const { emitted, parsedErrorMessages } = await captureWideEvents(async () => {
      await beforeDelete({ id: "user-1" });
      deleted = true;
    });

    expect(deleted).toBe(true);
    expect(emitted).toHaveLength(1);

    const recorded = JSON.stringify(emitted[0]);
    const surfaced =
      recorded.includes(TEARDOWN_FAILURE_MESSAGE) ||
      parsedErrorMessages.includes(TEARDOWN_FAILURE_MESSAGE);

    expect(surfaced).toBe(true);
  });
});

describe("polar customer removal during deletion", () => {
  it("surfaces a Polar failure instead of silently orphaning the billing customer", async () => {
    const deleteExternal = vi.fn(() => Promise.reject(new Error("polar unavailable")));

    await expect(
      deletePolarCustomerByExternalId({ customers: { deleteExternal } }, "user-1"),
    ).rejects.toThrow("polar unavailable");
  });

  it("treats a missing Polar customer as a successful removal", async () => {
    const deleteExternal = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("Customer does not exist."), {
          detail: "Customer does not exist.",
          error: "ResourceNotFound",
        }),
      ),
    );

    await expect(
      deletePolarCustomerByExternalId({ customers: { deleteExternal } }, "user-1"),
    ).resolves.toBeUndefined();

    expect(deleteExternal).toHaveBeenCalledWith({ externalId: "user-1" });
  });

  it("removes the Polar customer only once the user row is actually gone", async () => {
    const { auth, polarClient } = buildAuth({
      polarAccessToken: "polar-test-token",
      polarMode: "sandbox",
    });

    if (!polarClient) {
      throw new TypeError("polar client is not wired");
    }

    const deleteExternal = vi.fn(() => Promise.resolve());

    Object.defineProperty(polarClient, "customers", {
      configurable: true,
      value: { deleteExternal },
    });

    await resolveBeforeDelete(auth)({ id: "user-1" });

    expect(deleteExternal).not.toHaveBeenCalled();

    await resolveAfterDelete(auth)({ id: "user-1" });

    expect(deleteExternal).toHaveBeenCalledWith({ externalId: "user-1" });
  });

  it("surfaces a Polar teardown failure on the active wide event", async () => {
    const { auth, polarClient } = buildAuth({
      polarAccessToken: "polar-test-token",
      polarMode: "sandbox",
    });

    if (!polarClient) {
      throw new TypeError("polar client is not wired");
    }

    Object.defineProperty(polarClient, "customers", {
      configurable: true,
      value: {
        deleteExternal: vi.fn(() => Promise.reject(new Error("polar unavailable"))),
      },
    });

    const afterDelete = resolveAfterDelete(auth);

    const { emitted, parsedErrorMessages } = await captureWideEvents(async () => {
      await afterDelete({ id: "user-1" });
    });

    expect(emitted).toHaveLength(1);

    const recorded = JSON.stringify(emitted[0]);
    const surfaced =
      recorded.includes("polar unavailable") ||
      parsedErrorMessages.includes("polar unavailable");

    expect(surfaced).toBe(true);
  });
});

const blockingFailure = () =>
  Object.assign(new Error("push_channels residue for user-1 could not be captured"), {
    name: "TeardownBlockedError",
  });

describe("a blocking teardown failure reaches beforeDelete", () => {
  it("rethrows the blocking failure and never runs the steps behind it", async () => {
    const later = vi.fn(() => Promise.resolve());
    const recordResidue = vi.fn(() => Promise.resolve());
    const quiesce = createDeleteUserTeardown(
      [
        { name: "sync", run: () => Promise.reject(blockingFailure()) },
        { name: "later", run: later },
      ],
      9000,
      { recordResidue },
    );

    await captureWideEvents(async () => {
      const outcome: unknown = await quiesce("user-1").then(
        () => null,
        (error: unknown) => error,
      );

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).name).toBe("TeardownBlockedError");
      expect(later).not.toHaveBeenCalled();
    });
  });

  it("keeps swallowing an ordinary step failure and still records its residue", async () => {
    const later = vi.fn(() => Promise.resolve());
    const recordResidue = vi.fn(() => Promise.resolve());
    const quiesce = createDeleteUserTeardown(
      [
        { name: "polar_customer", run: () => Promise.reject(new Error("polar unavailable")) },
        { name: "later", run: later },
      ],
      9000,
      { recordResidue },
    );

    await captureWideEvents(async () => {
      await expect(quiesce("user-1")).resolves.toBeUndefined();
    });

    expect(later).toHaveBeenCalledWith("user-1");
    expect(recordResidue).toHaveBeenCalledWith({
      externalId: "user-1",
      kind: "polar_customer",
      userId: "user-1",
    });
  });
});

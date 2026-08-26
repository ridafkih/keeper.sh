import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widelog, widelogger } from "widelogger";
import { createAuth } from "../src/index";
import { deletePolarCustomerByExternalId } from "../src/polar-customer-delete";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

/*
 * Incident 2026-08-25: user qhPedMZJCcAFPcqsdHGo5m8K5RLacWFx deleted their account at
 * 06:15:33 UTC and worker jobs for that user kept writing to their Google calendar until
 * 06:19:03 UTC. Account deletion cascades database rows but performs no sync teardown:
 * no job drain, no push-channel deregistration, no provider token revocation.
 *
 * These tests pin the missing contract. They are expected to FAIL until deletion becomes
 * a teardown.
 */

const stubDatabase = {} as BunSQLDatabase;

const buildAuth = (overrides: Record<string, unknown> = {}) =>
  createAuth({
    baseUrl: "http://localhost:3000",
    database: stubDatabase,
    secret: "test-secret",
    ...overrides,
  } as Parameters<typeof createAuth>[0]);

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "auth-test",
});

const emitted: unknown[] = [];
const parsedErrorMessages: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  parsedErrorMessages.length = 0;
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

const TEARDOWN_FAILURE_MESSAGE = "push channel deregistration unavailable";

describe("account deletion teardown", () => {
  it("runs a beforeDelete teardown while the user's rows still exist", () => {
    const { auth } = buildAuth();

    /*
     * Draining queue jobs, deregistering Google/Microsoft push channels, and revoking
     * provider OAuth tokens all need the user's calendar, channel, and credential rows.
     * Those rows are cascade-deleted with the user row, so the teardown must be wired
     * as beforeDelete; afterDelete is too late to ever do this work.
     */
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

    await context(async () => {
      widelog.errors((error) => {
        parsedErrorMessages.push((error as { message?: string }).message ?? String(error));
        return "delete-user-teardown-failed";
      });

      await beforeDelete({ id: "user-1" });
      deleted = true;

      widelog.flush();
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

    /*
     * The hook chain is user row deleted -> afterDelete -> Polar customer deleted. When
     * the Polar call fails the customer (and any still-active subscription) is orphaned
     * with the keeper-side user already gone, and nothing reconciles it later. Swallowing
     * the error guarantees the orphan is invisible; the failure must propagate so the
     * caller can retry or alert.
     */
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

    /*
     * Deleting a Polar customer is irreversible and needs none of the user's rows. Doing
     * it in beforeDelete destroys the billing customer of a user whose deletion may still
     * fail, leaving a live account with no billing record. It belongs after the row is
     * gone, once the deletion has actually committed.
     */
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

    await context(async () => {
      widelog.errors((error) => {
        parsedErrorMessages.push((error as { message?: string }).message ?? String(error));
        return "delete-user-teardown-failed";
      });

      await afterDelete({ id: "user-1" });

      widelog.flush();
    });

    expect(emitted).toHaveLength(1);

    const recorded = JSON.stringify(emitted[0]);
    const surfaced =
      recorded.includes("polar unavailable") ||
      parsedErrorMessages.includes("polar unavailable");

    expect(surfaced).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "delete-teardown-secret-long-enough-for-validation";
const USER_ID = "user-1";
const TOMBSTONE_KEY = `user:${USER_ID}:deleted`;
const DELETE_USER_URL = "http://localhost:3000/api/auth/delete-user";

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
};

const signCookieValue = async (value: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeURIComponent(`${value}.${toBase64(new Uint8Array(signature))}`);
};

interface TombstoneStore {
  keys: () => string[];
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<unknown>;
}

const createTombstoneStore = (): TombstoneStore => {
  const store = new Map<string, string>();

  return {
    del: (key) => Promise.resolve(Number(store.delete(key))),
    exists: (key) => Promise.resolve(Number(store.has(key))),
    keys: () => [...store.keys()],
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve("OK");
    },
  };
};

interface DeletionHarness {
  auth: ReturnType<typeof createAuth>["auth"];
  polarDeletions: string[];
  sequence: string[];
  tombstones: TombstoneStore;
  userRowExists: () => boolean;
}

const buildHarness = (deleteUserOutcome: "fails" | "succeeds"): Promise<DeletionHarness> => {
  const tombstones = createTombstoneStore();
  const polarDeletions: string[] = [];
  const sequence: string[] = [];
  const users = new Map<string, { id: string }>([[USER_ID, { id: USER_ID }]]);

  const deleteUserTeardown = async (userId: string) => {
    sequence.push("teardown");
    await tombstones.set(`user:${userId}:deleted`, String(Date.now()), "EX", 3600);
  };

  const deleteUserTeardownRollback = async (userId: string) => {
    sequence.push("teardown_rollback");
    await tombstones.del(`user:${userId}:deleted`);
  };

  const { auth, polarClient } = createAuth({
    baseUrl: "http://localhost:3000",
    database: {} as BunSQLDatabase,
    deleteUserTeardown,
    deleteUserTeardownRollback,
    polarAccessToken: "polar-test-token",
    polarMode: "sandbox",
    secret: SECRET,
  } as Parameters<typeof createAuth>[0]);

  if (!polarClient) {
    throw new TypeError("polar client is not wired");
  }

  Object.defineProperty(polarClient, "customers", {
    configurable: true,
    value: {
      deleteExternal: vi.fn((payload: { externalId: string }) => {
        sequence.push("polar_delete");
        polarDeletions.push(payload.externalId);
        return Promise.resolve({});
      }),
    },
  });

  const user = {
    createdAt: new Date(),
    email: "customer@example.com",
    emailVerified: true,
    id: USER_ID,
    name: "customer",
    updatedAt: new Date(),
  };
  const session = {
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    id: "session-1",
    token: "session-token",
    updatedAt: new Date(),
    userId: USER_ID,
  };

  return auth.$context.then((context) => {
    const internalAdapter = context.internalAdapter as unknown as Record<string, unknown>;

    internalAdapter.findSession = (token: string) => {
      if (token !== session.token) {
        return Promise.resolve(null);
      }

      return Promise.resolve({ session, user });
    };
    internalAdapter.findUserById = () => Promise.resolve(user);
    internalAdapter.updateSession = () => Promise.resolve(session);
    internalAdapter.deleteUserSessions = () => Promise.resolve();
    internalAdapter.deleteUser = (userId: string) => {
      sequence.push("row_delete");

      if (deleteUserOutcome === "fails") {
        return Promise.reject(
          Object.assign(new Error("deadlock detected"), { code: "40P01" }),
        );
      }

      users.delete(userId);
      return Promise.resolve();
    };

    return {
      auth,
      polarDeletions,
      sequence,
      tombstones,
      userRowExists: () => users.has(USER_ID),
    };
  });
};

const requestAccountDeletion = async (
  auth: ReturnType<typeof createAuth>["auth"],
): Promise<Response> => {
  const cookie = `better-auth.session_token=${await signCookieValue("session-token", SECRET)}`;

  return await auth.handler(
    new Request(DELETE_USER_URL, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }),
  );
};

describe("a failed user-row deletion must not strand a surviving account", () => {
  it("clears the sync-halt tombstone when the row deletion fails", async () => {
    const harness = await buildHarness("fails");

    const response = await requestAccountDeletion(harness.auth);

    expect(response.status).toBe(500);
    expect(harness.userRowExists()).toBe(true);
    expect(harness.tombstones.keys()).toEqual([]);
    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(0);
  });

  it("leaves the Polar customer intact when the row deletion fails", async () => {
    const harness = await buildHarness("fails");

    const response = await requestAccountDeletion(harness.auth);

    expect(response.status).toBe(500);
    expect(harness.polarDeletions).toEqual([]);
  });

  it("deletes the Polar customer only after the row deletion has committed", async () => {
    const harness = await buildHarness("succeeds");

    const response = await requestAccountDeletion(harness.auth);

    expect(response.status).toBe(200);
    expect(harness.userRowExists()).toBe(false);
    expect(harness.polarDeletions).toEqual([USER_ID]);
    expect(harness.sequence).toEqual(["teardown", "row_delete", "polar_delete"]);
  });

  it("keeps the tombstone in place after a successful deletion", async () => {
    const harness = await buildHarness("succeeds");

    await requestAccountDeletion(harness.auth);

    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(1);
    expect(harness.sequence).not.toContain("teardown_rollback");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "delete-teardown-secret-long-enough-for-validation";
const USER_ID = "user-1";
const TOMBSTONE_KEY = `user:${USER_ID}:deleted`;
const PROVISIONAL_KEY = `user:${USER_ID}:deleted:unconfirmed`;
const TOMBSTONE_TTL_SECONDS = 3600;
const DELETE_USER_URL = "http://localhost:3000/api/auth/delete-user";
const POST_COMMIT_FAILURE = "connection closed after commit";
const ROLLBACK_FAILURE = "redis blip: CONNECTION_BROKEN";

type RollbackOutcome = "erases_both_keys" | "fails_before_touching_the_store";

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
  ttlOf: (key: string) => number | null;
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<unknown>;
}

const createTombstoneStore = (): TombstoneStore => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  return {
    del: (key) => {
      ttls.delete(key);
      return Promise.resolve(Number(store.delete(key)));
    },
    exists: (key) => Promise.resolve(Number(store.has(key))),
    keys: () => [...store.keys()],
    set: (key, value, _mode, ttlSeconds) => {
      store.set(key, value);
      ttls.set(key, ttlSeconds);
      return Promise.resolve("OK");
    },
    ttlOf: (key) => ttls.get(key) ?? null,
  };
};

interface DeletionHarness {
  auth: ReturnType<typeof createAuth>["auth"];
  residue: unknown[];
  rolledBack: string[];
  tombstones: TombstoneStore;
  userRowExists: () => boolean;
}

const buildHarness = (rollbackOutcome: RollbackOutcome): Promise<DeletionHarness> => {
  const tombstones = createTombstoneStore();
  const residue: unknown[] = [];
  const rolledBack: string[] = [];
  const users = new Map<string, { id: string }>([[USER_ID, { id: USER_ID }]]);

  const deleteUserTeardown = async (userId: string) => {
    await tombstones.set(`user:${userId}:deleted`, String(Date.now()), "EX", TOMBSTONE_TTL_SECONDS);
  };

  const deleteUserTeardownRollback = async (userId: string) => {
    rolledBack.push(userId);

    if (rollbackOutcome === "fails_before_touching_the_store") {
      throw new Error(ROLLBACK_FAILURE);
    }

    await tombstones.del(`user:${userId}:deleted`);
    await tombstones.del(`user:${userId}:deleted:unconfirmed`);
  };

  const markDeleteUserTombstoneProvisional = async (userId: string) => {
    await tombstones.set(
      `user:${userId}:deleted:unconfirmed`,
      String(Date.now()),
      "EX",
      TOMBSTONE_TTL_SECONDS,
    );
  };

  const { auth, polarClient } = createAuth({
    baseUrl: "http://localhost:3000",
    database: {} as BunSQLDatabase,
    deleteUserResidueRecorder: (draft: unknown) => {
      residue.push(draft);
      return Promise.resolve();
    },
    deleteUserTeardown,
    deleteUserTeardownRollback,
    markDeleteUserTombstoneProvisional,
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
      deleteExternal: vi.fn(() => Promise.resolve({})),
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
    internalAdapter.findUserById = (userId: string) => Promise.resolve(users.get(userId) ?? null);
    internalAdapter.updateSession = () => Promise.resolve(session);
    internalAdapter.deleteUserSessions = () => Promise.resolve();
    internalAdapter.deleteUser = () => Promise.reject(new Error(POST_COMMIT_FAILURE));

    return {
      auth,
      residue,
      rolledBack,
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

describe("a survived row marks the tombstone provisional before rollback", () => {
  it("leaves an unconfirmed companion key when the rollback erase never lands", async () => {
    const harness = await buildHarness("fails_before_touching_the_store");

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(true);
    expect(harness.rolledBack).toEqual([USER_ID]);
    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(1);
    await expect(harness.tombstones.exists(PROVISIONAL_KEY)).resolves.toBe(1);
    expect(harness.tombstones.ttlOf(PROVISIONAL_KEY)).toBe(TOMBSTONE_TTL_SECONDS);
  });

  it("leaves redis empty when the rollback erase succeeds", async () => {
    const harness = await buildHarness("erases_both_keys");

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(true);
    expect(harness.rolledBack).toEqual([USER_ID]);
    expect(harness.tombstones.keys()).toEqual([]);
  });
});

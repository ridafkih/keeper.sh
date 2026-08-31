import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "delete-teardown-secret-long-enough-for-validation";
const USER_ID = "user-1";
const TOMBSTONE_KEY = `user:${USER_ID}:deleted`;
const DELETE_USER_URL = "http://localhost:3000/api/auth/delete-user";
const POST_COMMIT_FAILURE = "connection closed after commit";
const PRE_COMMIT_FAILURE = "deadlock detected";

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

type RowDeleteOutcome = "commits_then_rejects" | "rejects_without_committing";

interface DeletionHarness {
  auth: ReturnType<typeof createAuth>["auth"];
  polarDeletions: string[];
  residue: unknown[];
  rolledBack: string[];
  sequence: string[];
  tombstones: TombstoneStore;
  userRowExists: () => boolean;
}

const buildHarness = (outcome: RowDeleteOutcome): Promise<DeletionHarness> => {
  const tombstones = createTombstoneStore();
  const polarDeletions: string[] = [];
  const residue: unknown[] = [];
  const rolledBack: string[] = [];
  const sequence: string[] = [];
  const users = new Map<string, { id: string }>([[USER_ID, { id: USER_ID }]]);

  const deleteUserTeardown = async (userId: string) => {
    sequence.push("teardown");
    await tombstones.set(`user:${userId}:deleted`, String(Date.now()), "EX", 3600);
  };

  const deleteUserTeardownRollback = async (userId: string) => {
    sequence.push("teardown_rollback");
    rolledBack.push(userId);
    await tombstones.del(`user:${userId}:deleted`);
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
    internalAdapter.findUserById = (userId: string) => {
      if (!users.has(userId)) {
        return Promise.resolve(null);
      }

      return Promise.resolve(user);
    };
    internalAdapter.updateSession = () => Promise.resolve(session);
    internalAdapter.deleteUserSessions = () => {
      sequence.push("session_delete");
      return Promise.resolve();
    };
    internalAdapter.deleteUser = (userId: string) => {
      sequence.push("row_delete");

      if (outcome === "commits_then_rejects") {
        users.delete(userId);
        return Promise.reject(new Error(POST_COMMIT_FAILURE));
      }

      return Promise.reject(
        Object.assign(new Error(PRE_COMMIT_FAILURE), { code: "40P01" }),
      );
    };

    return {
      auth,
      polarDeletions,
      residue,
      rolledBack,
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

describe("a delete that commits before the promise rejects is past the point of no return", () => {
  it("does not roll the teardown back when the user row is already gone", async () => {
    const harness = await buildHarness("commits_then_rejects");

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(false);
    expect(harness.rolledBack).toEqual([]);
    expect(harness.sequence).not.toContain("teardown_rollback");
  });

  it("keeps the sync-halt tombstone when the user row is already gone", async () => {
    const harness = await buildHarness("commits_then_rejects");

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(false);
    expect(harness.tombstones.keys()).toEqual([TOMBSTONE_KEY]);
    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(1);
  });

  it("finishes the attempt by destroying the external state once the row is gone", async () => {
    const harness = await buildHarness("commits_then_rejects");

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(false);
    expect(harness.polarDeletions).toEqual([USER_ID]);
  });
});

describe("a delete that never committed still rolls back", () => {
  it("rolls the teardown back and clears the tombstone when the user row survives", async () => {
    const harness = await buildHarness("rejects_without_committing");

    const response = await requestAccountDeletion(harness.auth);

    expect(response.status).toBe(500);
    expect(harness.userRowExists()).toBe(true);
    expect(harness.rolledBack).toEqual([USER_ID]);
    expect(harness.sequence).toContain("teardown_rollback");
    expect(harness.tombstones.keys()).toEqual([]);
    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(0);
    expect(harness.polarDeletions).toEqual([]);
  });
});

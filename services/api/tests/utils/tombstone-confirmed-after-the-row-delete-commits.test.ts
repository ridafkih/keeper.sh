import { describe, expect, it } from "vitest";
import { createAuth } from "@keeper.sh/auth";
import { createUserDeletedCheck, PRESENT_ANSWER_FRESHNESS_MS } from "@keeper.sh/calendar";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "delete-teardown-secret-long-enough-for-validation";
const USER_ID = "user-1";
const TOMBSTONE_KEY = `user:${USER_ID}:deleted`;
const PROVISIONAL_KEY = `${TOMBSTONE_KEY}:unconfirmed`;
const TOMBSTONE_TTL_SECONDS = 3600;
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
  probeCount: () => number;
  isUserDeleted: () => Promise<boolean>;
  tombstones: TombstoneStore;
  userRowExists: () => boolean;
}

const buildHarness = async (): Promise<DeletionHarness> => {
  const tombstones = createTombstoneStore();
  const users = new Map<string, { id: string }>([[USER_ID, { id: USER_ID }]]);
  let probes = 0;

  const writeTombstonePair = async (userId: string): Promise<void> => {
    await tombstones.set(
      `user:${userId}:deleted:unconfirmed`,
      String(Date.now()),
      "EX",
      TOMBSTONE_TTL_SECONDS,
    );
    await tombstones.set(`user:${userId}:deleted`, String(Date.now()), "EX", TOMBSTONE_TTL_SECONDS);
  };

  const deleteUserTeardown = async (userId: string): Promise<void> => {
    await writeTombstonePair(userId);
  };

  const deleteUserTeardownRollback = async (userId: string): Promise<void> => {
    await tombstones.del(`user:${userId}:deleted`);
    await tombstones.del(`user:${userId}:deleted:unconfirmed`);
  };

  const markDeleteUserTombstoneProvisional = async (userId: string): Promise<void> => {
    await tombstones.set(
      `user:${userId}:deleted:unconfirmed`,
      String(Date.now()),
      "EX",
      TOMBSTONE_TTL_SECONDS,
    );
  };

  const confirmDeleteUserTombstone = async (userId: string): Promise<void> => {
    await tombstones.del(`user:${userId}:deleted:unconfirmed`);
  };

  const { auth } = createAuth({
    baseUrl: "http://localhost:3000",
    confirmDeleteUserTombstone,
    database: {} as BunSQLDatabase,
    deleteUserResidueRecorder: () => Promise.resolve(),
    deleteUserTeardown,
    deleteUserTeardownRollback,
    markDeleteUserTombstoneProvisional,
    secret: SECRET,
  } as Parameters<typeof createAuth>[0]);

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

  const context = await auth.$context;
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
  internalAdapter.deleteUser = (userId: string) => {
    users.delete(userId);
    return Promise.resolve();
  };

  const isUserDeleted = createUserDeletedCheck({ exists: tombstones.exists }, USER_ID, {
    freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
    isUserRowPresent: () => {
      probes += 1;
      return Promise.resolve(true);
    },
  });

  return {
    auth,
    isUserDeleted,
    probeCount: () => probes,
    tombstones,
    userRowExists: () => users.has(USER_ID),
  };
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

describe("the tombstone is confirmed once the user row delete commits", () => {
  it("answers deleted with no further user row probe on the next call", async () => {
    const harness = await buildHarness();

    await harness.tombstones.set(PROVISIONAL_KEY, "1", "EX", TOMBSTONE_TTL_SECONDS);
    await harness.tombstones.set(TOMBSTONE_KEY, "1", "EX", TOMBSTONE_TTL_SECONDS);

    await expect(harness.isUserDeleted()).resolves.toBe(false);
    expect(harness.probeCount()).toBe(1);

    await requestAccountDeletion(harness.auth);

    expect(harness.userRowExists()).toBe(false);
    await expect(harness.tombstones.exists(TOMBSTONE_KEY)).resolves.toBe(1);
    await expect(harness.tombstones.exists(PROVISIONAL_KEY)).resolves.toBe(0);

    await expect(harness.isUserDeleted()).resolves.toBe(true);
    expect(harness.probeCount()).toBe(1);
  });
});

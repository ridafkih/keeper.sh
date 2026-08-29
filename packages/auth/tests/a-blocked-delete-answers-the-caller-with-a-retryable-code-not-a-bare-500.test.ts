import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widelog, widelogger } from "widelogger";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "delete-teardown-secret-long-enough-for-validation";
const USER_ID = "user-1";
const DELETE_USER_URL = "http://localhost:3000/api/auth/delete-user";
const BLOCKED_MESSAGE = "sync-halt tombstone could not be established";

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

interface BlockedHarness {
  auth: ReturnType<typeof createAuth>["auth"];
  sequence: string[];
  sessionsExist: () => boolean;
  userRowExists: () => boolean;
}

const buildBlockedHarness = (): Promise<BlockedHarness> => {
  const sequence: string[] = [];
  const residue: unknown[] = [];
  const users = new Map<string, { id: string }>([[USER_ID, { id: USER_ID }]]);
  const sessions = new Set<string>([USER_ID]);

  const deleteUserTeardown = () => {
    sequence.push("teardown");

    return Promise.reject(
      Object.assign(new Error(BLOCKED_MESSAGE), { name: "TeardownBlockedError" }),
    );
  };

  const deleteUserTeardownRollback = () => {
    sequence.push("teardown_rollback");
    return Promise.resolve();
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
      deleteExternal: vi.fn(() => {
        sequence.push("polar_delete");
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
      if (token !== session.token || !sessions.has(USER_ID)) {
        return Promise.resolve(null);
      }

      return Promise.resolve({ session, user });
    };
    internalAdapter.findUserById = () => Promise.resolve(user);
    internalAdapter.updateSession = () => Promise.resolve(session);
    internalAdapter.deleteUserSessions = (userId: string) => {
      sequence.push("session_delete");
      sessions.delete(userId);
      return Promise.resolve();
    };
    internalAdapter.deleteUser = (userId: string) => {
      sequence.push("row_delete");
      users.delete(userId);
      return Promise.resolve();
    };

    return {
      auth,
      sequence,
      sessionsExist: () => sessions.has(USER_ID),
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

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "auth-blocked-delete-test",
});

describe("a blocked delete answers the caller with a retryable code, not a bare 500", () => {
  const emitted: unknown[] = [];
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

  it("answers 503 with a machine-readable TEARDOWN_BLOCKED body and leaves the account intact", async () => {
    const harness = await buildBlockedHarness();

    const response = await requestAccountDeletion(harness.auth);
    const raw = await response.text();

    expect(response.status).toBe(503);
    expect(harness.userRowExists()).toBe(true);
    expect(harness.sequence).not.toContain("row_delete");

    const body = JSON.parse(raw) as { code?: string; message?: string };

    expect(body.code).toBe("TEARDOWN_BLOCKED");
    expect(body.message).toBeTypeOf("string");
    expect(body.message?.toLowerCase()).toContain("not");
    expect(body.message?.toLowerCase()).toContain("deleted");
  });

  it("keeps the caller's session alive so the delete can be retried", async () => {
    const harness = await buildBlockedHarness();

    await requestAccountDeletion(harness.auth);

    expect(harness.sessionsExist()).toBe(true);
    expect(harness.sequence).not.toContain("session_delete");
  });

  it("labels the request-level wide event with a blocked slug", async () => {
    const harness = await buildBlockedHarness();

    await context(async () => {
      await requestAccountDeletion(harness.auth);

      widelog.flush();
    });

    expect(emitted).toHaveLength(1);
    expect(JSON.stringify(emitted[0])).toContain("delete-user-teardown-blocked");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createKeyring, openSecret } from "@keeper.sh/database";
import type { StoredSecret } from "@keeper.sh/database";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

interface EmittedEvent {
  outcome?: string;
  token?: { persist_attempts?: number; rotation_lost?: boolean };
}

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const statementTimeout = (): Error => {
  const error = new Error("canceling statement due to statement timeout");
  Object.defineProperty(error, "cause", { value: { errno: "57014" } });
  return error;
};

const constraintViolation = (): Error => new Error("duplicate key value violates unique constraint");

interface StoredCredential {
  accessToken: StoredSecret<"oauth_credentials.accessToken">;
  refreshToken: StoredSecret<"oauth_credentials.refreshToken">;
}

interface Persistence {
  attempts: number;
  stored: StoredCredential[];
}

const CREDENTIAL_ID = "credential-under-test";
const keyring = createKeyring();

const createDatabase = (
  failures: number,
  failureOf: () => Error,
): { database: BunSQLDatabase; persistence: Persistence } => {
  const persistence: Persistence = { attempts: 0, stored: [] };
  const database = {
    update: () => ({
      set: (values: StoredCredential) => ({
        where: () => {
          persistence.attempts += 1;
          if (persistence.attempts <= failures) {
            return Promise.reject(failureOf());
          }
          persistence.stored.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as BunSQLDatabase;
  return { database, persistence };
};

const grantOf = (rotatedToken: string | null) => {
  if (rotatedToken === null) {
    return { access_token: "fresh-access", expires_in: 3600 };
  }
  return { access_token: "fresh-access", expires_in: 3600, refresh_token: rotatedToken };
};

const refresh = async (
  database: BunSQLDatabase,
  rotatedToken: string | null,
): Promise<string | null> => {
  const refresher = createCoordinatedRefresher({
    calendarAccountId: "account-1",
    database,
    keyring,
    oauthCredentialId: CREDENTIAL_ID,
    rawRefresh: () => Promise.resolve(grantOf(rotatedToken)),
    refreshLockStore: null,
  });
  const failures: string[] = [];
  await context(async () => {
    try {
      await refresher("stored-refresh-token");
    } catch (error) {
      failures.push(String(error));
      widelog.set("outcome", "error");
    } finally {
      widelog.flush();
    }
  });
  return failures[0] ?? null;
};

const eventWithToken = (): EmittedEvent["token"] =>
  emitted.find(({ token }) => Boolean(token))?.token;

describe("persisting a refreshed credential", () => {
  it("keeps the rotated token when a transient write fails and then succeeds", async () => {
    const { database, persistence } = createDatabase(2, statementTimeout);

    const failure = await refresh(database, "rotated-refresh-token");

    expect(failure).toBeNull();
    expect(persistence.attempts).toBe(3);
    const [stored] = persistence.stored;
    if (!stored) {
      throw new Error("expected the refreshed credential to be stored");
    }
    expect(openSecret(stored.refreshToken, keyring, CREDENTIAL_ID)).toBe("rotated-refresh-token");
    expect(openSecret(stored.accessToken, keyring, CREDENTIAL_ID)).toBe("fresh-access");
    expect(eventWithToken()?.persist_attempts).toBe(3);
  });

  it("does not retry a failure the database will answer the same way", async () => {
    const { database, persistence } = createDatabase(1, constraintViolation);

    const failure = await refresh(database, "rotated-refresh-token");

    expect(failure).toContain("duplicate key");
    expect(persistence.attempts).toBe(1);
  });

  it("reports a rotated token as lost once the retries are spent", async () => {
    const { database } = createDatabase(Number.MAX_SAFE_INTEGER, statementTimeout);

    const failure = await refresh(database, "rotated-refresh-token");

    expect(failure).toContain("statement timeout");
    expect(eventWithToken()?.rotation_lost).toBe(true);
  });

  it("reports no loss when the provider did not rotate the token", async () => {
    const { database } = createDatabase(Number.MAX_SAFE_INTEGER, statementTimeout);

    await refresh(database, null);

    expect(eventWithToken()?.rotation_lost).toBe(false);
  });
});

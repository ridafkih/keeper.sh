import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import * as coordinatedRefresher from "../../../src/core/oauth/coordinated-refresher";
import {
  createCoordinatedRefresher,
  persistRotatedCredential,
} from "../../../src/core/oauth/coordinated-refresher";

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

interface Persistence {
  attempts: number;
  stored: Record<string, unknown>[];
}

const createDatabase = (
  failures: number,
  failureOf: () => Error,
): { database: BunSQLDatabase; persistence: Persistence } => {
  const persistence: Persistence = { attempts: 0, stored: [] };
  const database = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
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
    oauthCredentialId: "credential-under-test",
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
    expect(persistence.stored[0]?.refreshToken).toBe("rotated-refresh-token");
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

const persistRotation = async (
  database: BunSQLDatabase,
  presentedRefreshToken: string,
  rotatedToken: string | null,
): Promise<unknown> => {
  const failures: unknown[] = [];
  await context(async () => {
    try {
      await persistRotatedCredential(
        database,
        "credential-under-test",
        presentedRefreshToken,
        grantOf(rotatedToken),
      );
    } catch (error) {
      failures.push(error);
    } finally {
      widelog.flush();
    }
  });
  return failures[0];
};

describe("the shared refresher raises a typed lost-rotation failure", () => {
  it("wraps an unpersisted rotation in a typed error carrying the persist failure", async () => {
    const { RotatedTokenNotPersistedError } = coordinatedRefresher as {
      RotatedTokenNotPersistedError?: new (cause: unknown) => Error;
    };
    expect(typeof RotatedTokenNotPersistedError).toBe("function");

    const { database } = createDatabase(1, constraintViolation);
    const persistFailure = await persistRotation(
      database,
      "stored-refresh-token",
      "rotated-refresh-token",
    );

    expect(persistFailure).toBeInstanceOf(RotatedTokenNotPersistedError);
    expect((persistFailure as Error).cause).toBeInstanceOf(Error);
    expect(String((persistFailure as Error).cause)).toContain("duplicate key");
  });

  it("lets the raw persist error escape when the provider did not rotate the token", async () => {
    const { database } = createDatabase(1, constraintViolation);
    const persistFailure = await persistRotation(
      database,
      "stored-refresh-token",
      "stored-refresh-token",
    );

    expect(String(persistFailure)).toContain("duplicate key");
    const typed = (coordinatedRefresher as {
      RotatedTokenNotPersistedError?: new (cause: unknown) => Error;
    }).RotatedTokenNotPersistedError;
    if (typeof typed === "function") {
      expect(persistFailure).not.toBeInstanceOf(typed);
    }
  });
});

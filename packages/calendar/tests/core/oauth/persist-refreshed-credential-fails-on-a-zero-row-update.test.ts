import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  RotatedTokenNotPersistedError,
  createCoordinatedRefresher,
} from "../../../src/core/oauth/coordinated-refresher";

interface EmittedEvent {
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

interface Persistence {
  attempts: number;
}

const createVanishedCredentialDatabase = (): {
  database: BunSQLDatabase;
  persistence: Persistence;
} => {
  const persistence: Persistence = { attempts: 0 };
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          persistence.attempts += 1;
          return Promise.resolve({ count: 0 });
        },
      }),
    }),
  } as unknown as BunSQLDatabase;
  return { database, persistence };
};

const refreshAgainstVanishedCredential = async (
  database: BunSQLDatabase,
  oauthCredentialId: string,
): Promise<unknown> => {
  const refresher = createCoordinatedRefresher({
    calendarAccountId: "account-under-test",
    database,
    oauthCredentialId,
    rawRefresh: () =>
      Promise.resolve({
        access_token: "fresh-access",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
      }),
    refreshLockStore: null,
  });

  const failures: unknown[] = [];
  await context(async () => {
    try {
      await refresher("stored-refresh-token");
    } catch (error) {
      failures.push(error);
    } finally {
      widelog.flush();
    }
  });
  return failures[0];
};

const eventWithToken = (): EmittedEvent["token"] =>
  emitted.find(({ token }) => Boolean(token))?.token;

describe("a credential update that matched no row", () => {
  it("raises a lost-rotation failure instead of reporting success", async () => {
    const { database } = createVanishedCredentialDatabase();

    const failure = await refreshAgainstVanishedCredential(
      database,
      "credential-deleted-by-cascade",
    );

    expect(failure).toBeInstanceOf(RotatedTokenNotPersistedError);
    expect(eventWithToken()?.rotation_lost).toBe(true);
  });

  it("does not spend the retry budget on a result the database will repeat", async () => {
    const { database, persistence } = createVanishedCredentialDatabase();

    await refreshAgainstVanishedCredential(database, "credential-swept-as-orphaned");

    expect(persistence.attempts).toBe(1);
    expect(eventWithToken()?.persist_attempts).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

interface EmittedEvent {
  token?: { rotation_lost?: boolean };
}

interface RecordedUpdate {
  values: Record<string, unknown>;
  where: unknown;
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

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const mentionsValue = (node: unknown, value: string): boolean => {
  const pending: unknown[] = [node];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === value) {
      return true;
    }
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const entry of Object.values(current as Record<string, unknown>)) {
      pending.push(entry);
    }
  }
  return false;
};

const createRecordingDatabase = (affectedRows: number) => {
  const updates: RecordedUpdate[] = [];
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          updates.push({ values, where });
          return Promise.resolve({ rowCount: affectedRows, rowsAffected: affectedRows });
        },
      }),
    }),
  } as unknown as BunSQLDatabase;
  return { database, updates };
};

describe("a refresh abandoned on its wall-time budget", () => {
  it("persists a rotation the provider issued anyway, guarded by the presented token", async () => {
    const { database, updates } = createRecordingDatabase(1);
    const refresher = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database,
      oauthCredentialId: "credential-under-test",
      rawRefresh: () =>
        sleep(200).then(() => ({
          access_token: "late-access",
          expires_in: 3600,
          refresh_token: "rotated-by-provider",
        })),
      refreshBudgetMs: 100,
      refreshLockStore: null,
    });

    const failures: string[] = [];
    await context(async () => {
      try {
        await refresher("stored-refresh-token");
      } catch (error) {
        failures.push(String(error));
      }
      await sleep(400);
      widelog.flush();
    });

    expect(failures[0]).toContain("wall-time budget");

    const rotationWrite = updates.find(
      ({ values }) => values.refreshToken === "rotated-by-provider",
    );
    expect(rotationWrite).toBeDefined();
    expect(mentionsValue(rotationWrite?.where, "credential-under-test")).toBe(true);
    expect(mentionsValue(rotationWrite?.where, "stored-refresh-token")).toBe(true);
  });

  it("reports the rotation lost when the compare-and-set matches no row", async () => {
    const { database, updates } = createRecordingDatabase(0);
    const refresher = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database,
      oauthCredentialId: "credential-under-test",
      rawRefresh: () =>
        sleep(200).then(() => ({
          access_token: "late-access",
          expires_in: 3600,
          refresh_token: "rotated-by-provider",
        })),
      refreshBudgetMs: 100,
      refreshLockStore: null,
    });

    await context(async () => {
      await refresher("stored-refresh-token").catch(() => undefined);
      await sleep(400);
      widelog.flush();
    });

    expect(updates.some(({ values }) => values.refreshToken === "rotated-by-provider")).toBe(true);
    expect(emitted.some(({ token }) => token?.rotation_lost === true)).toBe(true);
  });

  it("stays silent when the abandoned refresh rejects or does not rotate", async () => {
    const { database, updates } = createRecordingDatabase(1);
    const rejecting = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database,
      oauthCredentialId: "credential-under-test",
      rawRefresh: () =>
        sleep(200).then(() => {
          throw new Error("provider refused");
        }),
      refreshBudgetMs: 100,
      refreshLockStore: null,
    });
    const unrotating = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database,
      oauthCredentialId: "credential-under-test",
      rawRefresh: () =>
        sleep(200).then(() => ({
          access_token: "late-access",
          expires_in: 3600,
          refresh_token: "stored-refresh-token",
        })),
      refreshBudgetMs: 100,
      refreshLockStore: null,
    });

    await context(async () => {
      await rejecting("stored-refresh-token").catch(() => undefined);
      await unrotating("stored-refresh-token").catch(() => undefined);
      await sleep(400);
      widelog.flush();
    });

    expect(updates).toHaveLength(0);
    expect(emitted.some(({ token }) => token?.rotation_lost !== undefined)).toBe(false);
  });
});

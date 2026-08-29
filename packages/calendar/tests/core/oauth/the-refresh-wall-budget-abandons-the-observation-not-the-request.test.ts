import { describe, expect, it } from "vitest";
import { widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

interface RecordedUpdate {
  values: Record<string, unknown>;
  where: unknown;
}

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
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

const signalHonouringRefresh = (
  _refreshToken: string,
  options?: { signal?: AbortSignal },
) =>
  new Promise<{ access_token: string; expires_in: number; refresh_token: string }>(
    (resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted === true) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(() => {
        resolve({
          access_token: "late-access",
          expires_in: 3600,
          refresh_token: "rotated-by-provider",
        });
      }, 200);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    },
  );

describe("the refresh wall budget", () => {
  it("abandons the observation without aborting the in-flight refresh request", async () => {
    const { database, updates } = createRecordingDatabase(1);
    const refresher = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database,
      oauthCredentialId: "credential-under-test",
      rawRefresh: signalHonouringRefresh,
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
    });

    expect(failures[0]).toContain("wall-time budget");

    const rotationWrite = updates.find(
      ({ values }) => values.refreshToken === "rotated-by-provider",
    );
    expect(rotationWrite).toBeDefined();
    expect(mentionsValue(rotationWrite?.where, "credential-under-test")).toBe(true);
    expect(mentionsValue(rotationWrite?.where, "stored-refresh-token")).toBe(true);
  });
});

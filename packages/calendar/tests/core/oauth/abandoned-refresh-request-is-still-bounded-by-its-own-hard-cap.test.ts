import { describe, expect, it } from "vitest";
import { widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const createInertDatabase = () =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve({ rowCount: 1, rowsAffected: 1 }),
      }),
    }),
  }) as unknown as BunSQLDatabase;

describe("an abandoned refresh request", () => {
  it("is cut off by a hard cap strictly longer than the wall budget", async () => {
    const captured: AbortSignal[] = [];
    const refresher = createCoordinatedRefresher({
      calendarAccountId: "account-1",
      database: createInertDatabase(),
      oauthCredentialId: "credential-under-test",
      rawRefresh: (_refreshToken: string, options?: { signal?: AbortSignal }) => {
        const signal = options?.signal;
        if (signal === undefined) {
          throw new Error("rawRefresh was called without a signal");
        }
        captured.push(signal);
        return new Promise<{ access_token: string; expires_in: number }>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      refreshBudgetMs: 50,
      refreshHardCapMs: 400,
      refreshLockStore: null,
    } as unknown as Parameters<typeof createCoordinatedRefresher>[0]);

    await context(async () => {
      const started = Date.now();
      const failures: string[] = [];
      try {
        await refresher("stored-refresh-token");
      } catch (error) {
        failures.push(String(error));
      }
      expect(failures[0]).toContain("wall-time budget");

      const [runSignal] = captured;
      expect(runSignal).toBeDefined();

      await sleep(Math.max(0, started + 150 - Date.now()));
      expect(runSignal?.aborted).toBe(false);

      await sleep(Math.max(0, started + 500 - Date.now()));
      expect(runSignal?.aborted).toBe(true);
      expect((runSignal?.reason as Error | undefined)?.name).toBe("TimeoutError");
    });
  });
});

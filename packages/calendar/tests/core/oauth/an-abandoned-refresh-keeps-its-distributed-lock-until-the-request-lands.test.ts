import { describe, expect, it } from "vitest";
import { widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { RefreshLockStore } from "../../../src/core/oauth/refresh-coordinator";
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

const waitFor = async (condition: () => boolean, budgetMs: number): Promise<void> => {
  const deadlineAt = Date.now() + budgetMs;
  while (Date.now() < deadlineAt) {
    if (condition()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`condition never held within ${budgetMs}ms`);
};

const createHeldLockStore = () => {
  const held = new Set<string>();
  const store: RefreshLockStore = {
    release: (key: string) => {
      held.delete(key);
      return Promise.resolve();
    },
    tryAcquire: (key: string) => {
      if (held.has(key)) {
        return Promise.resolve(false);
      }
      held.add(key);
      return Promise.resolve(true);
    },
  };
  return { held, store };
};

const createStubDatabase = () => {
  const updates: Record<string, unknown>[] = [];
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve({ rowCount: 1, rowsAffected: 1 });
        },
      }),
    }),
  } as unknown as BunSQLDatabase;
  return { database, updates };
};

interface ProviderResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

describe("a refresh abandoned on its wall-time budget", () => {
  it("keeps the distributed lock until the in-flight provider request lands", async () => {
    const { database, updates } = createStubDatabase();
    const { held, store } = createHeldLockStore();
    const oauthCredentialId = `credential-${crypto.randomUUID()}`;
    const presented: string[] = [];

    const pending: { settle: ((result: ProviderResult) => void) | null } = { settle: null };
    const providerRequest = new Promise<ProviderResult>((resolve) => {
      pending.settle = resolve;
    });

    const abandoned = createCoordinatedRefresher({
      acquireBudgetMs: 250,
      calendarAccountId: "account-1",
      database,
      oauthCredentialId,
      rawRefresh: (refreshToken: string) => {
        presented.push(refreshToken);
        return providerRequest;
      },
      refreshBudgetMs: 150,
      refreshHardCapMs: 5000,
      refreshLockStore: store,
    });

    const peer = createCoordinatedRefresher({
      acquireBudgetMs: 250,
      calendarAccountId: "account-1",
      database,
      oauthCredentialId,
      rawRefresh: (refreshToken: string) => {
        presented.push(refreshToken);
        return Promise.resolve({
          access_token: "peer-access",
          expires_in: 3600,
          refresh_token: "rt-peer",
        });
      },
      refreshBudgetMs: 150,
      refreshHardCapMs: 5000,
      refreshLockStore: store,
    });

    await context(async () => {
      const startedAt = Date.now();
      await expect(abandoned("rt-1")).rejects.toThrow(/wall-time budget/);
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(600);
      expect(held.size).toBe(1);

      await expect(peer("rt-1")).rejects.toThrow(
        "Token refresh already in progress on another instance",
      );
      expect(presented).toEqual(["rt-1"]);

      pending.settle?.({ access_token: "late-access", expires_in: 3600, refresh_token: "rt-2" });

      await waitFor(() => updates.some((values) => values.refreshToken === "rt-2"), 2000);
      await waitFor(() => held.size === 0, 2000);
    });
  }, 15_000);
});

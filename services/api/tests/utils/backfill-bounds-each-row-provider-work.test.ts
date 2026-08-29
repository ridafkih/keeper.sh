import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCredentialRefreshLock as realRunWithCredentialRefreshLock }
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";
import { resolveProviderAccountIdentity as realResolveProviderAccountIdentity }
  from "../../../../packages/calendar/src/core/oauth/provider-account-identity";
import { oneRowUpdated } from "../helpers/update-outcome";
import type { UpdateOutcome } from "../helpers/update-outcome";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

interface RecordedError {
  slug: string;
}

const ROW_BUDGET_MS = 250;
const WATCHDOG_MS = 4000;
const HEALTHY_PROVIDER_ACCOUNT_ID = "healthy-provider-account-id";
const HEALTHY_ACCESS_TOKEN = "healthy-access-token";

let recordedUpdates: RecordedUpdate[] = [];
let recordedErrors: RecordedError[] = [];
let refreshSignals: (AbortSignal | undefined)[] = [];
let userInfoSignals: (AbortSignal | undefined)[] = [];
let brownoutMode: "none" | "refresh" | "userinfo" = "none";

const settlesOnlyOnAbort = (signal: AbortSignal | undefined): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(new Error("the provider call was aborted")),
      { once: true },
    );
  });

type SelectPromise = Promise<unknown[]> & {
  from: () => SelectPromise;
  innerJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const createSelectBuilder = (): SelectPromise => {
  const chain = Promise.resolve([]) as unknown as SelectPromise;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve([]);
  return chain;
};

const updateForTable = (table: unknown) => ({
  set: (values: Record<string, unknown>) => {
    recordedUpdates.push({ table: getTableName(table as never), values });

    const chain = Promise.resolve() as Promise<void> & {
      where: () => Promise<UpdateOutcome>;
    };
    chain.where = () => Promise.resolve(oneRowUpdated());

    return chain;
  },
});

vi.mock("@/context", () => ({
  database: {
    select: () => createSelectBuilder(),
    update: updateForTable,
  },
  oauthProviders: {
    getProvider: () => ({
      fetchUserInfo: (_accessToken: string, options?: { signal?: AbortSignal }) => {
        userInfoSignals.push(options?.signal);

        if (brownoutMode === "userinfo") {
          return settlesOnlyOnAbort(options?.signal);
        }

        return Promise.resolve({ email: "person@example.com", id: HEALTHY_PROVIDER_ACCOUNT_ID });
      },
      refreshAccessToken: (_refreshToken: string, options?: { signal?: AbortSignal }) => {
        refreshSignals.push(options?.signal);

        if (brownoutMode === "refresh") {
          return settlesOnlyOnAbort(options?.signal);
        }

        return Promise.resolve({
          access_token: HEALTHY_ACCESS_TOKEN,
          expires_in: 3600,
          refresh_token: "rotated-refresh-token",
        });
      },
    }),
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => Promise<void>) => callback(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: (_error: unknown, fields: { slug: string }) => {
      recordedErrors.push({ slug: fields.slug });
      return null;
    },
    flush: () => null,
    set: () => null,
  },
}));

vi.mock("@keeper.sh/calendar", () => ({
  resolveProviderAccountIdentity: realResolveProviderAccountIdentity,
  runWithCredentialRefreshLock: realRunWithCredentialRefreshLock,
}));

interface BackfillRow {
  accessToken: string;
  accountNeedsReauthentication: boolean;
  accountRowId: string;
  credentialNeedsReauthentication: boolean;
  email: string | null;
  expiresAt: Date;
  oauthCredentialId: string;
  provider: string;
  refreshToken: string;
}

interface BackfillTally {
  failed: number;
  skippedReauth: number;
  updated: number;
}

interface BackfillDeadline {
  remainingMs: () => number;
  signal: AbortSignal;
}

const scriptModule = await import("../../src/scripts/backfill-provider-account-ids") as {
  backfillRow?: (
    row: BackfillRow,
    tally: BackfillTally,
    deadline?: BackfillDeadline,
  ) => Promise<void>;
};

const openDeadline = (budgetMs: number): BackfillDeadline => {
  const expiresAt = Date.now() + budgetMs;

  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    signal: AbortSignal.timeout(budgetMs),
  };
};

const rowWithStaleToken = (): BackfillRow => ({
  accessToken: "stale-access-token",
  accountNeedsReauthentication: false,
  accountRowId: "account-brownout",
  credentialNeedsReauthentication: false,
  email: "person@example.com",
  expiresAt: new Date(Date.now() - 60_000),
  oauthCredentialId: `credential-${crypto.randomUUID()}`,
  provider: "google",
  refreshToken: "stored-refresh-token",
});

const rowWithLiveToken = (accountRowId: string): BackfillRow => ({
  ...rowWithStaleToken(),
  accessToken: HEALTHY_ACCESS_TOKEN,
  accountRowId,
  expiresAt: new Date(Date.now() + 3_600_000),
});

const backfillRowUnderTest = async (
  row: BackfillRow,
  tally: BackfillTally,
  deadline: BackfillDeadline,
): Promise<void> => {
  const { backfillRow } = scriptModule;
  expect(typeof backfillRow).toBe("function");
  if (!backfillRow) {
    throw new Error("the backfill script does not export backfillRow");
  }

  const watchdog = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error("backfillRow never settled: the row's provider work is unbounded")),
      WATCHDOG_MS,
    );
  });

  await Promise.race([backfillRow(row, tally, deadline), watchdog]);
};

const emptyTally = (): BackfillTally => ({ failed: 0, skippedReauth: 0, updated: 0 });

beforeEach(() => {
  recordedUpdates = [];
  recordedErrors = [];
  refreshSignals = [];
  userInfoSignals = [];
  brownoutMode = "none";
});

describe("the provider account id backfill bounds each row's provider work", () => {
  it("gives up on a row whose refresh goes silent and moves on to a healthy row", async () => {
    const tally = emptyTally();
    brownoutMode = "refresh";
    const startedAt = Date.now();

    await backfillRowUnderTest(rowWithStaleToken(), tally, openDeadline(ROW_BUDGET_MS));

    expect(Date.now() - startedAt).toBeLessThan(WATCHDOG_MS);
    expect(tally.failed).toBe(1);
    expect(tally.updated).toBe(0);
    expect(recordedErrors).toEqual([{ slug: "backfill-provider-account-id-failed" }]);

    brownoutMode = "none";
    await backfillRowUnderTest(
      rowWithLiveToken("account-healthy"),
      tally,
      openDeadline(ROW_BUDGET_MS),
    );

    expect(tally.failed).toBe(1);
    expect(tally.updated).toBe(1);
    expect(recordedUpdates).toContainEqual({
      table: "calendar_accounts",
      values: { accountId: HEALTHY_PROVIDER_ACCOUNT_ID },
    });
  });

  it("gives up on a row whose user info call goes silent", async () => {
    const tally = emptyTally();
    brownoutMode = "userinfo";
    const startedAt = Date.now();

    await backfillRowUnderTest(
      rowWithLiveToken("account-userinfo-brownout"),
      tally,
      openDeadline(ROW_BUDGET_MS),
    );

    expect(Date.now() - startedAt).toBeLessThan(WATCHDOG_MS);
    expect(tally.failed).toBe(1);
    expect(tally.updated).toBe(0);
    expect(recordedErrors).toEqual([{ slug: "backfill-provider-account-id-failed" }]);
    expect(userInfoSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it("spends one composed deadline across the refresh and the user info call", async () => {
    const tally = emptyTally();
    const deadline = openDeadline(ROW_BUDGET_MS);

    await backfillRowUnderTest(rowWithStaleToken(), tally, deadline);

    expect(tally.updated).toBe(1);
    expect(refreshSignals).toHaveLength(1);
    expect(userInfoSignals).toHaveLength(1);
    expect(refreshSignals[0]).toBe(deadline.signal);
    expect(userInfoSignals[0]).toBe(deadline.signal);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_DEADLINE_SETTLE_RESERVE_MS } from "@/utils/connect-deadline";

const REAL_IDLE_TIMEOUT_SECONDS = 30;
const STUBBED_IDLE_TIMEOUT_SECONDS = 60;
const MS_PER_SECOND = 1000;
const MINIMUM_USABLE_PROVIDER_IO_BUDGET_MS = 29_000;

let idleTimeoutSeconds = REAL_IDLE_TIMEOUT_SECONDS;

vi.mock("@keeper.sh/constants", () => ({
  get SERVER_IDLE_TIMEOUT_SECONDS() {
    return idleTimeoutSeconds;
  },
}));

vi.mock("@/context", () => ({
  baseUrl: "https://keeper.test.invalid",
  database: {},
}));

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

vi.mock("@/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/utils/destinations", () => ({
  exchangeCodeForTokens: () => Promise.resolve({}),
  fetchUserInfo: () => Promise.resolve({ email: null, id: "sub-1" }),
  validateState: () => Promise.resolve({ userId: "user-1" }),
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: () => Promise.resolve("credential-1"),
  deleteOAuthSourceCredential: () => Promise.resolve(true),
}));

vi.mock("@/utils/oauth-sources", () => ({
  importOAuthAccountCalendars: () => Promise.resolve("account-1"),
}));

const loadConnectBudgetMs = async (): Promise<number> => {
  vi.resetModules();
  const module = await import("@/routes/api/sources/callback/[provider]");
  const { OAUTH_CALLBACK_CONNECT_BUDGET_MS: budget } = module as {
    OAUTH_CALLBACK_CONNECT_BUDGET_MS: unknown;
  };

  expect(typeof budget).toBe("number");

  return budget as number;
};

beforeEach(() => {
  idleTimeoutSeconds = REAL_IDLE_TIMEOUT_SECONDS;
});

describe("oauth callback uses the wall time it is legally allowed", () => {
  it("spends nearly the whole server idle timeout on provider i/o", async () => {
    const budgetMs = await loadConnectBudgetMs();

    expect(budgetMs).toBeLessThan(REAL_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND);
    expect(budgetMs - CONNECT_DEADLINE_SETTLE_RESERVE_MS)
      .toBeGreaterThanOrEqual(MINIMUM_USABLE_PROVIDER_IO_BUDGET_MS);
  });

  it("is derived from the server idle timeout rather than hard-coded", async () => {
    idleTimeoutSeconds = STUBBED_IDLE_TIMEOUT_SECONDS;
    const budgetMs = await loadConnectBudgetMs();

    expect(budgetMs).toBeLessThan(STUBBED_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND);
    expect(budgetMs - CONNECT_DEADLINE_SETTLE_RESERVE_MS).toBeGreaterThanOrEqual(
      STUBBED_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND
        - (REAL_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND - MINIMUM_USABLE_PROVIDER_IO_BUDGET_MS),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@keeper.sh/constants";
import { createSilentProviderFetch }
  from "../../../../../../../packages/calendar/tests/support/silent-provider-fetch";

const BASE_URL = "https://keeper.test.invalid";
const USER_ID = "user-1";
const ACCOUNT_EMAIL = "person@gmail.test.invalid";
const GOOGLE_SUB = "google-sub-1";
const ACCOUNT_ID = "account-1";
const CREDENTIAL_ID = "credential-1";
const TOKEN_LIFETIME_SECONDS = 3600;
const MS_PER_SECOND = 1000;
const CASE_TIMEOUT_MS = 120_000;

type Leg = "exchangeCodeForTokens" | "fetchUserInfo" | "importOAuthAccountCalendars";

let recordedSignals: Partial<Record<Leg, AbortSignal | null>> = {};
let firstLegGoesSilent = false;

const findSignal = (values: unknown[]): AbortSignal | null => {
  for (const value of values) {
    if (value instanceof AbortSignal) {
      return value;
    }

    if (typeof value === "object" && value !== null) {
      const nested = Object.values(value as Record<string, unknown>)
        .find((candidate) => candidate instanceof AbortSignal);

      if (nested instanceof AbortSignal) {
        return nested;
      }
    }
  }

  return null;
};

const record = (leg: Leg, values: unknown[]): AbortSignal | null => {
  const signal = findSignal(values);
  recordedSignals[leg] = signal;
  return signal;
};

const tokenResponse = {
  access_token: "access-token-1",
  expires_in: TOKEN_LIFETIME_SECONDS,
  refresh_token: "refresh-token-1",
  scope: "https://www.googleapis.com/auth/calendar",
};

vi.mock("@/context", () => ({
  baseUrl: BASE_URL,
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
  exchangeCodeForTokens: (...values: unknown[]) => {
    const signal = record("exchangeCodeForTokens", values);

    if (!firstLegGoesSilent) {
      return Promise.resolve(tokenResponse);
    }

    const silentFetch = createSilentProviderFetch();
    return silentFetch("https://oauth2.googleapis.test.invalid/token", {
      method: "POST",
      signal: signal ?? undefined,
    });
  },
  fetchUserInfo: (...values: unknown[]) => {
    record("fetchUserInfo", values);
    return Promise.resolve({ email: ACCOUNT_EMAIL, id: GOOGLE_SUB });
  },
  validateState: () => Promise.resolve({ userId: USER_ID }),
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: (
    _userId: string,
    _values: unknown,
    options?: { onCredentialCreated?: (id: string) => void },
  ) => {
    options?.onCredentialCreated?.(CREDENTIAL_ID);
    return Promise.resolve(CREDENTIAL_ID);
  },
  deleteOAuthSourceCredential: () => Promise.resolve(),
}));

vi.mock("@/utils/oauth-sources", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    importOAuthAccountCalendars: (...values: unknown[]) => {
      record("importOAuthAccountCalendars", values);
      return Promise.resolve(ACCOUNT_ID);
    },
  };
});

const callbackModule = await import("@/routes/api/sources/callback/[provider]");

const callbackRoute = callbackModule.GET as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const runCallback = async (): Promise<Response> =>
  await callbackRoute({
    params: { provider: "google" },
    request: new Request(
      `${BASE_URL}/api/sources/callback/google?code=auth-code-1&state=state-1`,
    ),
  });

beforeEach(() => {
  recordedSignals = {};
  firstLegGoesSilent = false;
});

describe("the oauth callback runs under one shared deadline", () => {
  it("hands the same abort signal to every provider leg of the connect", async () => {
    const response = await runCallback();

    expect(new URL(response.headers.get("location") ?? "").pathname)
      .toBe(`/dashboard/accounts/${ACCOUNT_ID}/setup`);

    const exchangeSignal = recordedSignals.exchangeCodeForTokens ?? null;
    const userInfoSignal = recordedSignals.fetchUserInfo ?? null;
    const importSignal = recordedSignals.importOAuthAccountCalendars ?? null;

    expect(exchangeSignal).toBeInstanceOf(AbortSignal);
    expect(userInfoSignal).toBe(exchangeSignal);
    expect(importSignal).toBe(exchangeSignal);
  });

  it("declares a connect budget below the server idle timeout", () => {
    const budgets = Object.entries(callbackModule as Record<string, unknown>)
      .filter(([, value]) => typeof value === "number");

    expect(budgets).toHaveLength(1);
    expect(budgets[0]?.[1] as number)
      .toBeLessThan(SERVER_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND);
  });

  it("gives up inside the window when the first provider leg goes silent", async () => {
    firstLegGoesSilent = true;

    const startedAt = Date.now();
    const response = await runCallback();
    const elapsedMs = Date.now() - startedAt;

    expect(new URL(response.headers.get("location") ?? "").searchParams.get("source"))
      .toBe("error");
    expect(elapsedMs).toBeLessThan(SERVER_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND);
    expect(recordedSignals.exchangeCodeForTokens?.aborted).toBe(true);
    expect(recordedSignals.fetchUserInfo).toBeUndefined();
    expect(recordedSignals.importOAuthAccountCalendars).toBeUndefined();
  }, CASE_TIMEOUT_MS);
});

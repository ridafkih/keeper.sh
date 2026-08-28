import { afterEach, describe, expect, test } from "vitest";
import { createGoogleOAuthService } from "../../../src/core/oauth/google";
import { createMicrosoftOAuthService } from "../../../src/core/oauth/microsoft";
import { createSilentProviderFetch } from "../../support/silent-provider-fetch";

type ExchangeWithSignal = (
  code: string,
  callbackUrl: string,
  signal?: AbortSignal,
) => Promise<unknown>;

const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret" };
const CALLBACK_URL = "https://app.example.com/cb";

const STILL_PENDING = Symbol("exchangeCodeForTokens never settled");

const stateStore = {
  consume: () => Promise.resolve(null),
  set: () => Promise.resolve(),
};

const tokenPayload = {
  access_token: "access-token",
  expires_in: 3600,
  refresh_token: "refresh-token",
  scope: "scope",
  token_type: "Bearer",
};

const originalFetch = globalThis.fetch;

const settlementOrPendingSentinel = async (
  work: Promise<unknown>,
): Promise<unknown> => {
  const drained = new Promise<typeof STILL_PENDING>((resolve) => {
    setTimeout(() => {
      resolve(STILL_PENDING);
    }, 0);
  });

  return await Promise.race([
    work.then((value: unknown) => value, (error: unknown) => error),
    drained,
  ]);
};

const googleExchange = (): ExchangeWithSignal =>
  createGoogleOAuthService(CREDENTIALS, stateStore)
    .exchangeCodeForTokens as unknown as ExchangeWithSignal;

const microsoftExchange = (): ExchangeWithSignal =>
  createMicrosoftOAuthService(CREDENTIALS, stateStore)
    .exchangeCodeForTokens as unknown as ExchangeWithSignal;

const expectCallerAbortToEndTheExchange = async (
  exchange: ExchangeWithSignal,
): Promise<void> => {
  const caller = new AbortController();
  const callerReason = new Error("caller abandoned the oauth token exchange");
  caller.abort(callerReason);

  globalThis.fetch = createSilentProviderFetch();

  const outcome = await settlementOrPendingSentinel(
    exchange("code", CALLBACK_URL, caller.signal),
  );

  expect(outcome).toBe(callerReason);
};

const expectDefaultTimeoutWithoutACallerSignal = async (
  exchange: ExchangeWithSignal,
): Promise<void> => {
  const seen: RequestInit[] = [];

  globalThis.fetch = ((_input: unknown, init?: RequestInit): Promise<Response> => {
    seen.push(init ?? {});
    return Promise.resolve(
      new Response(JSON.stringify(tokenPayload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;

  await exchange("code", CALLBACK_URL);

  expect(seen).toHaveLength(1);
  expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(seen[0]?.signal?.aborted).toBe(false);
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("exchange code for tokens honours a caller signal", () => {
  test("google exchange rejects with the caller's own abort reason", async () => {
    await expectCallerAbortToEndTheExchange(googleExchange());
  });

  test("microsoft exchange rejects with the caller's own abort reason", async () => {
    await expectCallerAbortToEndTheExchange(microsoftExchange());
  });

  test("google exchange keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(googleExchange());
  });

  test("microsoft exchange keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(microsoftExchange());
  });
});

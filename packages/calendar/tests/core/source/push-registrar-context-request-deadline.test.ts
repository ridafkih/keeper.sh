import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createRegistrarContextFactory } from "../../../src/core/source/push-registrar-context";
import { registerGoogleWatchChannel } from "../../../src/providers/google/push/watch-channel";
import type { RegistrarContextRequest } from "../../../src/core/source/manage-push-channels";
import { createSilentProviderFetch } from "../../support/silent-provider-fetch";

const ACCOUNT_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const CALENDAR_ID = "c1c1c1c1-0000-4000-8000-000000000002";
const USER_ID = "c1c1c1c1-0000-4000-8000-000000000003";
const CREDENTIAL_ID = "c1c1c1c1-0000-4000-8000-000000000004";
const REQUEST_BUDGET_MS = 50;
const AN_HOUR_MS = 3_600_000;

const credentialDatabase = (): BunSQLDatabase => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{
      accessToken: "access-token-under-test",
      calendarAccountId: ACCOUNT_ID,
      expiresAt: new Date(Date.now() + AN_HOUR_MS),
      oauthCredentialId: CREDENTIAL_ID,
      refreshToken: "refresh-token-under-test",
    }]),
  };

  return chain as unknown as BunSQLDatabase;
};

const factoryUnderTest = () =>
  createRegistrarContextFactory({
    database: credentialDatabase(),
    rateLimiterRedis: { eval: () => Promise.resolve([0, 0]) },
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: () => Promise.resolve(true),
    },
    requestTimeoutMs: REQUEST_BUDGET_MS,
    webhookConfig: {
      googleCallbackUrl: "https://webhooks.example.test/google",
      outlookCallbackUrl: "https://webhooks.example.test/outlook",
    },
  });

const googleCalendarRequest = (): RegistrarContextRequest => ({
  channelId: "channel-under-test",
  provider: "google",
  requestedExpiresAt: new Date(Date.now() + AN_HOUR_MS),
  scope: {
    accountId: ACCOUNT_ID,
    calendarId: CALENDAR_ID,
    externalCalendarId: "primary",
    kind: "calendar",
    providerAccountId: null,
    userId: USER_ID,
  },
});

const abortReasonOf = (signal: AbortSignal): Promise<unknown> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => {
      resolve(signal.reason);
    }, { once: true });
  });

describe("push channel registration context carries a request deadline", () => {
  it("hands every registrar context a signal that aborts on its configured budget", async () => {
    const context = await factoryUnderTest()(googleCalendarRequest());

    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(context.signal?.aborted).toBe(false);

    const reason = await abortReasonOf(context.signal as AbortSignal);

    expect((reason as { name?: string }).name).toBe("TimeoutError");
  });

  it("rejects a google watch registration the provider never answers", async () => {
    const context = await factoryUnderTest()(googleCalendarRequest());
    const handedSignals: Array<AbortSignal | null | undefined> = [];
    const silentProvider = createSilentProviderFetch({
      onRequest: (init) => {
        handedSignals.push(init.signal);
      },
    });

    const failure = await registerGoogleWatchChannel(
      googleCalendarRequest().scope,
      "secret-under-test",
      { ...context, fetchImpl: silentProvider },
    ).then(() => null, (error: unknown) => error);

    expect(handedSignals).toEqual([context.signal]);
    expect(failure).toBe(context.signal?.reason);
    expect((failure as { name?: string }).name).toBe("TimeoutError");
  });
});

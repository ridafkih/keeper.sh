import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createRegistrarContextFactory } from "../../../src/core/source/push-registrar-context";
import { registerGoogleWatchChannel } from "../../../src/providers/google/push/watch-channel";
import type { RegistrarContextRequest } from "../../../src/core/source/manage-push-channels";

const ACCOUNT_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const CALENDAR_ID = "c1c1c1c1-0000-4000-8000-000000000002";
const USER_ID = "c1c1c1c1-0000-4000-8000-000000000003";
const CREDENTIAL_ID = "c1c1c1c1-0000-4000-8000-000000000004";
const REQUEST_BUDGET_MS = 1000;
const ABORT_OBSERVATION_CEILING_MS = 4000;
const STALL_OBSERVATION_CEILING_MS = 4000;
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

const abortReasonWithin = (signal: AbortSignal, ceilingMs: number): Promise<unknown> => {
  const ceilingReached = Promise.withResolvers<unknown>();

  const ceiling = setTimeout(() => {
    ceilingReached.resolve(
      new Error(`registrar context signal never aborted within ${ceilingMs}ms`),
    );
  }, ceilingMs);

  const aborted = new Promise<unknown>((resolve) => {
    signal.addEventListener("abort", () => {
      resolve(signal.reason);
    }, { once: true });
  });

  return Promise.race([aborted, ceilingReached.promise]).finally(() => {
    clearTimeout(ceiling);
  });
};

describe("push channel registration context carries a request deadline", () => {
  it("hands every registrar context a signal that aborts on its configured budget", async () => {
    const context = await factoryUnderTest()(googleCalendarRequest());

    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(context.signal?.aborted).toBe(false);

    const reason = await abortReasonWithin(
      context.signal as AbortSignal,
      ABORT_OBSERVATION_CEILING_MS,
    );

    expect((reason as { name?: string }).name).toBe("TimeoutError");
  });

  it("rejects a google watch registration the provider never answers", async () => {
    const stalled = Bun.serve({ fetch: () => new Promise<Response>(() => {}), port: 0 });

    try {
      const context = await factoryUnderTest()(googleCalendarRequest());
      const forwarding = ((_input: unknown, init?: RequestInit) =>
        fetch(stalled.url, init)) as unknown as typeof fetch;

      const outcome = await Promise.race([
        registerGoogleWatchChannel(
          googleCalendarRequest().scope,
          "secret-under-test",
          { ...context, fetchImpl: forwarding },
        ).then(
          () => "resolved",
          (error: unknown) => error,
        ),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve("still pending");
          }, STALL_OBSERVATION_CEILING_MS);
        }),
      ]);

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as { name?: string }).name).toBe("TimeoutError");
    } finally {
      await stalled.stop(true);
    }
  });
});

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

const DELETED_USER = "user-being-deleted";
const CHANNEL_COUNT = 10;
const DIALS_BEFORE_ABORT = 8;
const SECRET_HASH = "a".repeat(64);

vi.mock("@/context", () => ({
  database,
  env: {},
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: {
    googleCallbackUrl: "https://example.com/api/webhook/google",
    outlookCallbackUrl: "https://example.com/api/webhook/outlook",
  },
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

const { AbandonedPushChannelError, deregisterUserPushChannels } = await import(
  "../../src/utils/push-notifications/deregister-account-channels"
);

const DDL = `
create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" text,
  "authType" text not null,
  "caldavCredentialId" uuid,
  "calendarsRefreshAttemptedAt" timestamptz,
  "calendarsRefreshedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "displayName" text,
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "reauthenticationSource" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);
create table calendar_push_channels (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid not null,
  "calendarId" uuid,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz,
  "failureCount" integer not null default 0,
  "lastFailureAt" timestamptz,
  "lastNotificationAt" timestamptz,
  "nextAttemptAt" timestamptz,
  "provider" text not null,
  "providerChannelId" text,
  "providerResourceId" text,
  "reauthorizeRequestedAt" timestamptz,
  "resourcePath" text,
  "secretHash" text not null,
  "state" text not null default 'registering',
  "updatedAt" timestamptz not null default now(),
  "userId" text not null,
  "verifiedAt" timestamptz
);
`;

const seedChannel = async (index: number): Promise<void> => {
  const label = `google-channel-${index}`;
  const credentialRows = await client.query<{ id: string }>(
    `insert into oauth_credentials
      ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ($1, $2, now() + interval '1 hour', 'google', $3, $4)
     returning id`,
    [
      `token-${label}`,
      `deleted+${index}@example.com`,
      `refresh-${label}`,
      DELETED_USER,
    ],
  ).then((result) => result.rows);
  const credentialId = credentialRows[0]?.id;
  if (credentialId === undefined) {
    throw new Error(`Seeding oauth credentials for ${label} returned no row`);
  }

  const accountRows = await client.query<{ id: string }>(
    `insert into calendar_accounts ("authType", "oauthCredentialId", "provider", "userId")
     values ('oauth', $1, 'google', $2)
     returning id`,
    [credentialId, DELETED_USER],
  ).then((result) => result.rows);

  const accountId = accountRows[0]?.id;
  if (accountId === undefined) {
    throw new Error(`Seeding a calendar account for ${label} returned no row`);
  }

  await client.query(
    `insert into calendar_push_channels
      ("accountId", "provider", "providerChannelId", "providerResourceId",
       "resourcePath", "secretHash", "state", "userId")
     values ($1, 'google', $2, $3, '/calendars/primary/events', $4, 'active', $5)`,
    [accountId, label, `resource-${index}`, SECRET_HASH, DELETED_USER],
  );
};

beforeAll(async () => {
  await client.exec(DDL);
  for (let index = 0; index < CHANNEL_COUNT; index += 1) {
    await seedChannel(index);
  }
});

describe("push channels abandoned when the teardown deadline aborts the run", () => {
  it("carries the credential stored for the channel's calendar account even when the channel was never dialed", async () => {
    const controller = new AbortController();
    const dialedChannelIds: string[] = [];

    const hangingFetch = ((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      dialedChannelIds.push(body.id);
      if (dialedChannelIds.length >= DIALS_BEFORE_ABORT) {
        controller.abort(new Error("Teardown step push_channels exceeded its deadline"));
      }
      const signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        if (signal === null) {
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason);
        });
      });
    }) as unknown as typeof globalThis.fetch;

    vi.stubGlobal("fetch", hangingFetch);

    try {
      const failure = await deregisterUserPushChannels(DELETED_USER, controller.signal)
        .then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      const abandonments = (failure as AggregateError).errors;
      expect(abandonments).toHaveLength(CHANNEL_COUNT);
      expect(dialedChannelIds).toHaveLength(DIALS_BEFORE_ABORT);

      const neverDialed = abandonments.filter((error) =>
        error instanceof AbandonedPushChannelError
        && !dialedChannelIds.includes(error.residue.providerChannelId));
      expect(neverDialed.length).toBe(CHANNEL_COUNT - DIALS_BEFORE_ABORT);

      const credentials = abandonments.map((error) => {
        expect(error).toBeInstanceOf(AbandonedPushChannelError);
        const { residue } = error as InstanceType<typeof AbandonedPushChannelError>;
        return {
          accessToken: residue.credential?.accessToken ?? null,
          providerChannelId: residue.providerChannelId,
        };
      });

      for (const credential of credentials) {
        expect(credential.accessToken).toBe(`token-${credential.providerChannelId}`);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

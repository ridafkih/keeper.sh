import { describe, expect, it } from "bun:test";
import type { RefreshLockStore } from "@keeper.sh/calendar";
import type Redis from "ioredis";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  ProviderResolutionStatus,
  resolveSyncProviderOutcome,
} from "./resolve-provider";

const createNoopDatabase = (): BunSQLDatabase =>
  ({
    select: () => {
      throw new Error("database.select should not be called");
    },
  } as unknown as BunSQLDatabase);

const createBaseOptions = () => ({
  accountId: "account-1",
  calendarId: "calendar-1",
  database: createNoopDatabase(),
  oauthConfig: {},
  outboxRedis: {} as Redis,
  refreshLockStore: null as RefreshLockStore | null,
  userId: "user-1",
});

describe("resolveSyncProviderOutcome routing", () => {
  it("returns unsupported for unknown provider without hitting database", async () => {
    const outcome = await resolveSyncProviderOutcome({
      ...createBaseOptions(),
      provider: "unknown-provider",
    });

    expect(outcome).toEqual({
      status: ProviderResolutionStatus.UNSUPPORTED_PROVIDER,
    });
  });

  it("returns misconfigured for caldav providers without encryption key", async () => {
    const outcome = await resolveSyncProviderOutcome({
      ...createBaseOptions(),
      provider: "caldav",
    });

    expect(outcome).toEqual({
      status: ProviderResolutionStatus.MISCONFIGURED_PROVIDER,
    });
  });
});

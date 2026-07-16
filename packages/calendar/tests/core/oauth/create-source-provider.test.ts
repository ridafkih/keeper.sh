import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  createOAuthSourceProvider,
  type OAuthSourceAccount,
} from "../../../src/core/oauth/create-source-provider";
import type { OAuthSourceConfig } from "../../../src/core/types";

const database = {} as BunSQLDatabase;

const createTestProvider = (
  options: {
    getAllSources: (database: BunSQLDatabase) => Promise<OAuthSourceAccount[]>;
    getSourcesForUser?: (database: BunSQLDatabase, userId: string) => Promise<OAuthSourceAccount[]>;
  },
) =>
  createOAuthSourceProvider<OAuthSourceAccount, OAuthSourceConfig>({
    buildConfig: (): never => {
      throw new Error("No sources should be built in this test");
    },
    createProviderInstance: (): never => {
      throw new Error("No provider should be created in this test");
    },
    database,
    ...options,
    oauthProvider: {
      refreshAccessToken: () => Promise.reject(new Error("Token refresh should not run")),
    },
  });

describe("createOAuthSourceProvider", () => {
  it("passes the user ID to user-scoped source queries", async () => {
    const requestedUserIds: string[] = [];
    const provider = createTestProvider({
      getAllSources: () => Promise.reject(new Error("Global query should not run")),
      getSourcesForUser: (_database, userId) => {
        requestedUserIds.push(userId);
        return Promise.resolve([]);
      },
    });

    await provider.syncSourcesForUser("user-1");

    expect(requestedUserIds).toEqual(["user-1"]);
  });

  it("keeps an explicit unscoped method for intentional global syncs", async () => {
    const globalQueries: string[] = [];
    const provider = createTestProvider({
      getAllSources: () => {
        globalQueries.push("queried");
        return Promise.resolve([]);
      },
    });

    await provider.syncAllSources();

    expect(globalQueries).toEqual(["queried"]);
  });
});

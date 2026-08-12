import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  DefaultFeedDeletionError,
  FEED_LIMIT_ERROR_MESSAGE,
  FeedLimitError,
  FeedNotFoundError,
  buildFeedListQuery,
  ensureDefaultFeed,
  runCreateFeed,
  runDeleteFeed,
  runSetFeedCalendars,
} from "../../src/utils/ical-feeds";
import { generateFeedToken } from "../../src/utils/ical-feed-tokens";

interface Feed {
  id: string;
  userId: string;
  name: string;
  token: string;
  isDefault: boolean;
  legacyAlias: boolean;
}

interface CreateFeedTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  ensureDefaultFeed: (userId: string) => Promise<Feed>;
  countUserFeeds: (userId: string) => Promise<number>;
  insertFeed: (values: Record<string, unknown>) => Promise<Feed>;
}

interface CreateFeedDependencies {
  resolveFeedLimit: (userId: string) => Promise<number>;
  generateToken: () => string;
  withTransaction: <TResult>(
    callback: (transaction: CreateFeedTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

interface SetFeedCalendarsTransaction {
  feedExists: (userId: string, feedId: string) => Promise<boolean>;
  findOwnedPullCalendarIds: (userId: string, calendarIds: string[]) => Promise<string[]>;
  replaceFeedCalendars: (feedId: string, calendarIds: string[]) => Promise<void>;
}

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: "feed-default",
  userId: "user-1",
  name: "My Calendar",
  token: `feed_${"c".repeat(64)}`,
  isDefault: true,
  legacyAlias: false,
  ...overrides,
});

describe("generateFeedToken", () => {
  it("mints an opaque prefixed token that is never derived from a username", () => {

    const token = generateFeedToken();

    expect(token).toMatch(/^feed_[0-9a-f]{64}$/);
    expect(token).not.toContain("ada");
  });

  it("never repeats a token across a thousand draws", () => {
    const mintToken = generateFeedToken;

    const tokens = new Set(Array.from({ length: 1000 }, () => mintToken()));

    expect(tokens.size).toBe(1000);
  });

  it("does not mint api-token-namespaced values", () => {

    expect(generateFeedToken().startsWith("kpr_")).toBe(false);
  });
});

describe("ensureDefaultFeed", () => {
  it("returns the existing default feed without inserting a second", async () => {
    const existing = makeFeed({ id: "feed-existing" });
    const insertAttempts: Record<string, unknown>[] = [];

    const resolved = await ensureDefaultFeed({
      insertDefaultFeed: (values) => {
        insertAttempts.push(values);
        return Promise.resolve(null);
      },
      findDefaultFeed: () => Promise.resolve(existing),
      generateToken: () => `feed_${"d".repeat(64)}`,
    }, "user-1");

    expect(resolved).toEqual(existing);
    expect(insertAttempts).toHaveLength(1);
  });

  it("creates the default feed when the user has none", async () => {
    const insertAttempts: Record<string, unknown>[] = [];

    const resolved = await ensureDefaultFeed({
      insertDefaultFeed: (values) => {
        insertAttempts.push(values);
        return Promise.resolve(makeFeed({ id: "feed-new" }));
      },
      findDefaultFeed: () => Promise.resolve(null),
      generateToken: () => `feed_${"e".repeat(64)}`,
    }, "user-1");

    expect(resolved.id).toBe("feed-new");
    expect(insertAttempts[0]).toMatchObject({ userId: "user-1", isDefault: true });
  });

  it("never mints a legacy username alias for a lazily created feed", async () => {
    const insertAttempts: Record<string, unknown>[] = [];

    await ensureDefaultFeed({
      insertDefaultFeed: (values) => {
        insertAttempts.push(values);
        return Promise.resolve(makeFeed());
      },
      findDefaultFeed: () => Promise.resolve(null),
      generateToken: () => `feed_${"f".repeat(64)}`,
    }, "user-1");

    expect(insertAttempts[0]?.legacyAlias).not.toBe(true);
  });

  it("throws when no default feed can be resolved after a conflict", async () => {

    await expect(ensureDefaultFeed({
      insertDefaultFeed: () => Promise.resolve(null),
      findDefaultFeed: () => Promise.resolve(null),
      generateToken: () => `feed_${"0".repeat(64)}`,
    }, "user-1")).rejects.toThrow();
  });

  it("resolves without any advisory-lock dependency", async () => {

    const resolved = await ensureDefaultFeed({
      insertDefaultFeed: () => Promise.resolve(makeFeed()),
      findDefaultFeed: () => Promise.resolve(null),
      generateToken: () => `feed_${"1".repeat(64)}`,
    }, "user-1");

    expect(resolved.isDefault).toBe(true);
  });
});

const makeCreateFeedTransaction = (
  overrides: Partial<CreateFeedTransaction> & { calls?: string[] } = {},
): { transaction: CreateFeedTransaction; calls: string[]; inserted: Record<string, unknown>[] } => {
  const calls = overrides.calls ?? [];
  const inserted: Record<string, unknown>[] = [];
  const transaction: CreateFeedTransaction = {
    acquireUserLock: () => {
      calls.push("acquireUserLock");
      return Promise.resolve();
    },
    ensureDefaultFeed: () => {
      calls.push("ensureDefaultFeed");
      return Promise.resolve(makeFeed());
    },
    countUserFeeds: () => {
      calls.push("countUserFeeds");
      return Promise.resolve(0);
    },
    insertFeed: (values) => {
      calls.push("insertFeed");
      inserted.push(values);
      return Promise.resolve(makeFeed({ id: "feed-created", isDefault: false }));
    },
    ...overrides,
  };
  return { transaction, calls, inserted };
};

describe("runCreateFeed", () => {
  it("refuses a free user a second feed", async () => {
    const { transaction, inserted } = makeCreateFeedTransaction({
      countUserFeeds: () => Promise.resolve(1),
    });

    await expect(runCreateFeed({ userId: "user-1", name: "Work only" }, {
      resolveFeedLimit: () => Promise.resolve(1),
      generateToken: () => `feed_${"2".repeat(64)}`,
      withTransaction: (callback) => callback(transaction),
    })).rejects.toBeInstanceOf(FeedLimitError);

    expect(FEED_LIMIT_ERROR_MESSAGE).toBe(
      "Feed limit reached. Upgrade to Keeper.sh Pro for unlimited iCal feeds.",
    );
    expect(inserted).toEqual([]);
  });

  it("counts the implicit default feed so a first-ever POST cannot bypass the limit", async () => {
    let feedCount = 0;
    const { transaction, inserted } = makeCreateFeedTransaction({
      ensureDefaultFeed: () => {
        feedCount += 1;
        return Promise.resolve(makeFeed());
      },
      countUserFeeds: () => Promise.resolve(feedCount),
    });

    await expect(runCreateFeed({ userId: "user-1", name: "Work only" }, {
      resolveFeedLimit: () => Promise.resolve(1),
      generateToken: () => `feed_${"3".repeat(64)}`,
      withTransaction: (callback) => callback(transaction),
    })).rejects.toBeInstanceOf(FeedLimitError);

    expect(inserted).toEqual([]);
  });

  it("locks, materializes the default feed, counts, then inserts", async () => {
    const { transaction, calls } = makeCreateFeedTransaction();

    await runCreateFeed({ userId: "user-1", name: "Work only" }, {
      resolveFeedLimit: () => Promise.resolve(Infinity),
      generateToken: () => `feed_${"4".repeat(64)}`,
      withTransaction: (callback) => callback(transaction),
    });

    expect(calls).toEqual([
      "acquireUserLock",
      "ensureDefaultFeed",
      "countUserFeeds",
      "insertFeed",
    ]);
  });

  it("rolls the whole transaction back when the limit is hit", async () => {
    const { transaction } = makeCreateFeedTransaction({
      countUserFeeds: () => Promise.resolve(1),
    });
    let rolledBack = false;

    await expect(runCreateFeed({ userId: "user-1", name: "Work only" }, {
      resolveFeedLimit: () => Promise.resolve(1),
      generateToken: () => `feed_${"5".repeat(64)}`,
      withTransaction: async (callback) => {
        try {
          return await callback(transaction);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    })).rejects.toThrow();

    expect(rolledBack).toBe(true);
  });

  it("lets a pro user create unlimited feeds, each with its own opaque token", async () => {
    const tokens = [`feed_${"6".repeat(64)}`, `feed_${"7".repeat(64)}`];
    let index = 0;
    const { transaction, inserted } = makeCreateFeedTransaction({
      countUserFeeds: () => Promise.resolve(7),
    });

    const dependencies: CreateFeedDependencies = {
      resolveFeedLimit: () => Promise.resolve(Infinity),
      generateToken: () => {
        const token = tokens[index] ?? "";
        index += 1;
        return token;
      },
      withTransaction: (callback) => callback(transaction),
    };

    await runCreateFeed({ userId: "user-1", name: "Work only" }, dependencies);
    await runCreateFeed({ userId: "user-1", name: "Family" }, dependencies);

    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.token).toBe(tokens[0]);
    expect(inserted[1]?.token).toBe(tokens[1]);
    expect(inserted[0]?.token).not.toBe(inserted[1]?.token);
    for (const values of inserted) {
      expect(values.isDefault).not.toBe(true);
      expect(String(values.token)).toMatch(/^feed_[0-9a-f]{64}$/);
    }
  });

  it("resolves the plan limit outside the transaction", async () => {
    const calls: string[] = [];
    const { transaction } = makeCreateFeedTransaction({ calls });

    await runCreateFeed({ userId: "user-1", name: "Work only" }, {
      resolveFeedLimit: () => {
        calls.push("resolveFeedLimit");
        return Promise.resolve(Infinity);
      },
      generateToken: () => `feed_${"8".repeat(64)}`,
      withTransaction: (callback) => callback(transaction),
    });

    expect(calls[0]).toBe("resolveFeedLimit");
  });
});

const makeSetCalendarsTransaction = (
  overrides: Partial<SetFeedCalendarsTransaction> = {},
): { transaction: SetFeedCalendarsTransaction; writes: string[][] } => {
  const writes: string[][] = [];
  return {
    writes,
    transaction: {
      feedExists: () => Promise.resolve(true),
      findOwnedPullCalendarIds: (_userId, calendarIds) => Promise.resolve(calendarIds),
      replaceFeedCalendars: (_feedId, calendarIds) => {
        writes.push(calendarIds);
        return Promise.resolve();
      },
      ...overrides,
    },
  };
};

describe("runSetFeedCalendars", () => {
  it("refuses calendars the caller does not own and writes nothing", async () => {
    const { transaction, writes } = makeSetCalendarsTransaction({
      findOwnedPullCalendarIds: () => Promise.resolve(["calendar-mine"]),
    });

    await expect(runSetFeedCalendars(
      { userId: "user-1", feedId: "feed-1", calendarIds: ["calendar-mine", "calendar-theirs"] },
      { withTransaction: (callback) => callback(transaction) },
    )).rejects.toThrow();

    expect(writes).toEqual([]);
  });

  it("refuses a feed the caller does not own before touching calendars", async () => {
    const ownershipCalls: string[] = [];
    const { transaction, writes } = makeSetCalendarsTransaction({
      feedExists: () => Promise.resolve(false),
      findOwnedPullCalendarIds: (_userId, calendarIds) => {
        ownershipCalls.push("findOwnedPullCalendarIds");
        return Promise.resolve(calendarIds);
      },
    });

    await expect(runSetFeedCalendars(
      { userId: "user-2", feedId: "feed-of-user-1", calendarIds: ["calendar-a"] },
      { withTransaction: (callback) => callback(transaction) },
    )).rejects.toBeInstanceOf(FeedNotFoundError);

    expect(ownershipCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("deduplicates the incoming calendar ids", async () => {
    const { transaction, writes } = makeSetCalendarsTransaction();

    await runSetFeedCalendars(
      { userId: "user-1", feedId: "feed-1", calendarIds: ["calendar-a", "calendar-a", "calendar-b"] },
      { withTransaction: (callback) => callback(transaction) },
    );

    expect(writes).toEqual([["calendar-a", "calendar-b"]]);
  });

  it("accepts an empty selection without an ownership lookup", async () => {
    const ownershipCalls: string[] = [];
    const { transaction, writes } = makeSetCalendarsTransaction({
      findOwnedPullCalendarIds: (_userId, calendarIds) => {
        ownershipCalls.push("findOwnedPullCalendarIds");
        return Promise.resolve(calendarIds);
      },
    });

    await runSetFeedCalendars(
      { userId: "user-1", feedId: "feed-1", calendarIds: [] },
      { withTransaction: (callback) => callback(transaction) },
    );

    expect(ownershipCalls).toEqual([]);
    expect(writes).toEqual([[]]);
  });
});

describe("runDeleteFeed", () => {
  it("refuses to delete the default feed", async () => {
    const deleted: string[] = [];

    await expect(runDeleteFeed({ userId: "user-1", feedId: "feed-default" }, {
      findFeed: () => Promise.resolve(makeFeed({ isDefault: true })),
      deleteFeed: (_userId, feedId) => {
        deleted.push(feedId);
        return Promise.resolve(feedId);
      },
    })).rejects.toBeInstanceOf(DefaultFeedDeletionError);

    expect(deleted).toEqual([]);
  });

  it("scopes the lookup and the delete to the owner", async () => {
    const lookups: [string, string][] = [];
    const deletes: [string, string][] = [];

    await runDeleteFeed({ userId: "user-1", feedId: "feed-work" }, {
      findFeed: (userId, feedId) => {
        lookups.push([userId, feedId]);
        return Promise.resolve(makeFeed({ id: "feed-work", isDefault: false }));
      },
      deleteFeed: (userId, feedId) => {
        deletes.push([userId, feedId]);
        return Promise.resolve(feedId);
      },
    });

    expect(lookups).toEqual([["user-1", "feed-work"]]);
    expect(deletes).toEqual([["user-1", "feed-work"]]);
  });

  it("does not delete another user's feed", async () => {
    const deletes: string[] = [];

    await expect(runDeleteFeed({ userId: "user-2", feedId: "feed-of-user-1" }, {
      findFeed: () => Promise.resolve(null),
      deleteFeed: (_userId, feedId) => {
        deletes.push(feedId);
        return Promise.resolve(feedId);
      },
    })).rejects.toBeInstanceOf(FeedNotFoundError);

    expect(deletes).toEqual([]);
  });
});

describe("buildFeedListQuery", () => {
  it("puts the default feed first with a total ordering", () => {
    const { sql } = buildFeedListQuery(drizzle.mock(), "user-1").toSQL();
    const [, ordering = ""] = sql.split(" order by ");

    expect(ordering.replaceAll('"ical_feeds".', "")).toBe(
      `"isDefault" desc, "createdAt" asc, "id" asc`,
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  handleGetIcalFeedsRoute,
  handlePostIcalFeedRoute,
} from "../../../../../src/routes/api/ical/feeds/index";
import {
  FEED_LIMIT_ERROR_MESSAGE,
  FeedLimitError,
} from "../../../../../src/utils/ical-feeds";

vi.mock("../../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../../src/context", () => ({
  baseUrl: "https://keeper.sh",
  database: {},
  premiumService: {},
}));

interface Feed {
  id: string;
  name: string;
  token: string;
  isDefault: boolean;
  legacyAlias: boolean;
  createdAt: string;
  calendarCount: number;
}

const readJson = (response: Response): Promise<unknown> => response.json();

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: "feed-default",
  name: "My Calendar",
  token: `feed_${"a".repeat(64)}`,
  isDefault: true,
  legacyAlias: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  calendarCount: 2,
  ...overrides,
});

describe("handlePostIcalFeedRoute", () => {
  it.each(["", "   ", "\t"])("rejects the blank name %j before creating", async (name) => {
    const created: string[] = [];

    const response = await handlePostIcalFeedRoute(
      { body: { name }, userId: "user-1" },
      {
        createFeed: (_userId, requested) => {
          created.push(requested);
          return Promise.reject(new Error("must not create a feed"));
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Feed name cannot be empty." });
    expect(created).toEqual([]);
  });

  it("returns 402 when a free user creates a second feed", async () => {
    const limitError = new FeedLimitError(FEED_LIMIT_ERROR_MESSAGE);
    const created: string[] = [];

    const response = await handlePostIcalFeedRoute(
      { body: { name: "Work only" }, userId: "user-1" },
      {
        createFeed: (_userId, name) => {
          created.push(name);
          return Promise.reject(limitError);
        },
      },
    );

    expect(response.status).toBe(402);
    expect(await readJson(response)).toEqual({
      error: "Feed limit reached. Upgrade to Keeper.sh Pro for unlimited iCal feeds.",
    });
    expect(created).toEqual(["Work only"]);
  });

  it("creates a feed for a pro user and returns its opaque token", async () => {
    const response = await handlePostIcalFeedRoute(
      { body: { name: "Work only" }, userId: "user-1" },
      {
        createFeed: (_userId, name) => Promise.resolve(makeFeed({
          id: "feed-work",
          name,
          token: `feed_${"b".repeat(64)}`,
          isDefault: false,
          legacyAlias: false,
          calendarCount: 0,
        })),
      },
    );

    expect(response.status).toBe(201);
    const body = await readJson(response) as Feed;
    expect(body.name).toBe("Work only");
    expect(body.token).toMatch(/^feed_[0-9a-f]{64}$/);
    expect(body.token).not.toContain("user-1");
  });

  it("trims the feed name before persisting it", async () => {
    const names: string[] = [];

    await handlePostIcalFeedRoute(
      { body: { name: "  Work only  " }, userId: "user-1" },
      {
        createFeed: (_userId, name) => {
          names.push(name);
          return Promise.resolve(makeFeed({ name }));
        },
      },
    );

    expect(names).toEqual(["Work only"]);
  });

  it("rejects a blank feed name", async () => {
    const created: string[] = [];

    const response = await handlePostIcalFeedRoute(
      { body: { name: "   " }, userId: "user-1" },
      {
        createFeed: (_userId, name) => {
          created.push(name);
          return Promise.resolve(makeFeed());
        },
      },
    );

    expect(response.status).toBe(400);
    expect(created).toEqual([]);
  });

  it("rejects unknown body keys", async () => {
    const created: string[] = [];

    const response = await handlePostIcalFeedRoute(
      { body: { name: "Work only", token: "feed_attacker" }, userId: "user-1" },
      {
        createFeed: (_userId, name) => {
          created.push(name);
          return Promise.resolve(makeFeed());
        },
      },
    );

    expect(response.status).toBe(400);
    expect(created).toEqual([]);
  });
});

describe("handleGetIcalFeedsRoute", () => {
  it("materializes the default feed before listing", async () => {
    const calls: string[] = [];

    await handleGetIcalFeedsRoute({ userId: "user-1" }, {
      ensureDefaultFeed: () => {
        calls.push("ensureDefaultFeed");
        return Promise.resolve(makeFeed());
      },
      listFeeds: () => {
        calls.push("listFeeds");
        return Promise.resolve([makeFeed()]);
      },
    });

    expect(calls).toEqual(["ensureDefaultFeed", "listFeeds"]);
  });

  it("returns the server ordering untouched when two feeds share a createdAt", async () => {
    const createdAt = "2026-02-02T00:00:00.000Z";
    const ordered = [
      makeFeed({ id: "feed-default", isDefault: true, createdAt }),
      makeFeed({ id: "feed-work", name: "Work only", isDefault: false, createdAt }),
    ];

    const response = await handleGetIcalFeedsRoute({ userId: "user-1" }, {
      ensureDefaultFeed: () => Promise.resolve(ordered[0] as Feed),
      listFeeds: () => Promise.resolve(ordered),
    });

    expect(response.status).toBe(200);
    const body = await readJson(response) as Feed[];
    expect(body.map(({ id }) => id)).toEqual(["feed-default", "feed-work"]);
  });

  it("never lists another user's feeds", async () => {
    const seenUserIds: string[] = [];

    await handleGetIcalFeedsRoute({ userId: "user-2" }, {
      ensureDefaultFeed: (userId) => {
        seenUserIds.push(userId);
        return Promise.resolve(makeFeed());
      },
      listFeeds: (userId) => {
        seenUserIds.push(userId);
        return Promise.resolve([]);
      },
    });

    expect(seenUserIds).toEqual(["user-2", "user-2"]);
  });
});

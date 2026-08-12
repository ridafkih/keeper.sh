import { describe, expect, it, vi } from "vitest";

import {
  handleDeleteIcalFeedRoute,
  handleGetIcalFeedRoute,
  handlePatchIcalFeedRoute,
} from "../../../../../src/routes/api/ical/feeds/[id]";
import {
  DefaultFeedDeletionError,
  FeedNotFoundError,
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
  userId: string;
  name: string;
  token: string;
  isDefault: boolean;
  legacyAlias: boolean;
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
}

interface PatchDependencies {
  canCustomizeIcalFeed: (userId: string) => Promise<boolean>;
  findFeed: (userId: string, feedId: string) => Promise<Feed | null>;
  updateFeed: (
    userId: string,
    feedId: string,
    updates: Record<string, unknown>,
  ) => Promise<Feed | null>;
  mirrorLegacySettings: (
    userId: string,
    updates: Record<string, unknown>,
  ) => Promise<void>;
}

const readJson = (response: Response): Promise<unknown> => response.json();

const SHARED_SETTINGS_COLUMNS = [
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
  "customEventName",
];

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: "feed-default",
  userId: "user-1",
  name: "My Calendar",
  token: `feed_${"a".repeat(64)}`,
  isDefault: true,
  legacyAlias: true,
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  customEventName: "Busy",
  ...overrides,
});

const makeDependencies = (
  overrides: Partial<PatchDependencies> = {},
): { dependencies: PatchDependencies; updates: [string, string, Record<string, unknown>][]; mirrors: Record<string, unknown>[] } => {
  const updates: [string, string, Record<string, unknown>][] = [];
  const mirrors: Record<string, unknown>[] = [];
  return {
    updates,
    mirrors,
    dependencies: {
      canCustomizeIcalFeed: () => Promise.resolve(true),
      findFeed: () => Promise.resolve(makeFeed()),
      updateFeed: (userId, feedId, patch) => {
        updates.push([userId, feedId, patch]);
        return Promise.resolve(makeFeed({ id: feedId, ...patch }));
      },
      mirrorLegacySettings: (_userId, patch) => {
        mirrors.push(patch);
        return Promise.resolve();
      },
      ...overrides,
    },
  };
};

describe("handlePatchIcalFeedRoute", () => {
  it("returns 403 when a free user edits feed settings", async () => {
    const { dependencies, updates } = makeDependencies({
      canCustomizeIcalFeed: () => Promise.resolve(false),
    });

    const response = await handlePatchIcalFeedRoute(
      { body: { includeEventName: true }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "iCal feed customization requires a Pro plan.",
    });
    expect(updates).toEqual([]);
  });

  it("lets a free user rename a feed", async () => {
    const { dependencies, updates } = makeDependencies({
      canCustomizeIcalFeed: () => Promise.resolve(false),
    });

    const response = await handlePatchIcalFeedRoute(
      { body: { name: "Work only" }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([["user-1", "feed-default", { name: "Work only" }]]);
  });

  it("gates the new per-feed filters behind the pro plan", async () => {
    const { dependencies, updates } = makeDependencies({
      canCustomizeIcalFeed: () => Promise.resolve(false),
    });

    const response = await handlePatchIcalFeedRoute(
      { body: { excludeFocusTime: true }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("applies settings only to the feed named in the path", async () => {
    const { dependencies, updates } = makeDependencies({
      findFeed: (userId, feedId) =>
        Promise.resolve(makeFeed({ id: feedId, userId, isDefault: false })),
    });

    await handlePatchIcalFeedRoute(
      { body: { includeEventName: true }, params: { id: "feed-work" }, userId: "user-1" },
      dependencies,
    );

    expect(updates).toEqual([["user-1", "feed-work", { includeEventName: true }]]);
  });

  it("mirrors default-feed settings into the legacy settings row", async () => {
    const { dependencies, mirrors } = makeDependencies({
      findFeed: () => Promise.resolve(makeFeed({ isDefault: true })),
    });

    await handlePatchIcalFeedRoute(
      {
        body: { includeEventName: true, excludeFocusTime: true, customEventName: "Away" },
        params: { id: "feed-default" },
        userId: "user-1",
      },
      dependencies,
    );

    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toEqual({ includeEventName: true, customEventName: "Away" });
    for (const key of Object.keys(mirrors[0] ?? {})) {
      expect(SHARED_SETTINGS_COLUMNS).toContain(key);
    }
  });

  it("does not mirror a non-default feed's settings", async () => {
    const { dependencies, mirrors } = makeDependencies({
      findFeed: () => Promise.resolve(makeFeed({ id: "feed-work", isDefault: false })),
    });

    await handlePatchIcalFeedRoute(
      { body: { includeEventName: true }, params: { id: "feed-work" }, userId: "user-1" },
      dependencies,
    );

    expect(mirrors).toEqual([]);
  });

  it("returns 404 for a feed owned by someone else", async () => {
    const { dependencies, updates } = makeDependencies({
      findFeed: () => Promise.resolve(null),
    });

    const response = await handlePatchIcalFeedRoute(
      { body: { name: "Mine now" }, params: { id: "feed-of-user-1" }, userId: "user-2" },
      dependencies,
    );

    expect(response.status).toBe(404);
    expect(updates).toEqual([]);
  });

  it("rejects a rename to an empty name", async () => {
    const { dependencies, updates } = makeDependencies();

    const response = await handlePatchIcalFeedRoute(
      { body: { name: "   " }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Feed name cannot be empty." });
    expect(updates).toEqual([]);
  });

  it("trims a renamed feed the same way creation does", async () => {
    const { dependencies, updates } = makeDependencies();

    await handlePatchIcalFeedRoute(
      { body: { name: "  Work only  " }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(updates).toEqual([["user-1", "feed-default", { name: "Work only" }]]);
  });

  it("rejects unknown body keys", async () => {
    const { dependencies, updates } = makeDependencies();

    const response = await handlePatchIcalFeedRoute(
      { body: { token: `feed_${"9".repeat(64)}` }, params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(updates).toEqual([]);
  });
});

describe("handleDeleteIcalFeedRoute", () => {
  it("refuses to delete the default feed", async () => {
    const rejection = new DefaultFeedDeletionError("The default feed cannot be deleted.");

    const response = await handleDeleteIcalFeedRoute(
      { params: { id: "feed-default" }, userId: "user-1" },
      { deleteFeed: () => Promise.reject(rejection) },
    );

    expect(response.status).toBe(409);
  });

  it("returns 404 when deleting a feed the caller does not own", async () => {
    const rejection = new FeedNotFoundError("Feed not found.");

    const response = await handleDeleteIcalFeedRoute(
      { params: { id: "feed-of-user-1" }, userId: "user-2" },
      { deleteFeed: () => Promise.reject(rejection) },
    );

    expect(response.status).toBe(404);
  });

  it("scopes the delete to the caller", async () => {
    const deletes: [string, string][] = [];

    const response = await handleDeleteIcalFeedRoute(
      { params: { id: "feed-work" }, userId: "user-1" },
      {
        deleteFeed: (userId, feedId) => {
          deletes.push([userId, feedId]);
          return Promise.resolve();
        },
      },
    );

    expect(response.status).toBe(204);
    expect(deletes).toEqual([["user-1", "feed-work"]]);
  });
});

const LEGACY_ICAL_URL = "https://keeper.sh/api/cal/ada.ics";

const makeGetDependencies = (feed: Feed | null) => {
  const legacyLookups: string[] = [];
  const findFeed = () => {
    if (!feed) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...feed, icalUrl: `https://keeper.sh/api/cal/${feed.token}.ics` });
  };

  return {
    legacyLookups,
    dependencies: {
      findFeed,
      resolveLegacyUrl: (userId: string) => {
        legacyLookups.push(userId);
        return Promise.resolve(LEGACY_ICAL_URL);
      },
    },
  };
};

describe("handleGetIcalFeedRoute", () => {
  it("returns the still-active legacy link for a backfilled default feed", async () => {
    const { dependencies, legacyLookups } = makeGetDependencies(
      makeFeed({ isDefault: true, legacyAlias: true }),
    );

    const response = await handleGetIcalFeedRoute(
      { params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      legacyIcalUrl: LEGACY_ICAL_URL,
    });
    expect(legacyLookups).toEqual(["user-1"]);
  });

  it("returns no legacy link for a feed created after the migration", async () => {
    const { dependencies, legacyLookups } = makeGetDependencies(
      makeFeed({ isDefault: true, legacyAlias: false }),
    );

    const response = await handleGetIcalFeedRoute(
      { params: { id: "feed-default" }, userId: "user-1" },
      dependencies,
    );

    expect(await readJson(response)).not.toHaveProperty("legacyIcalUrl");
    expect(legacyLookups).toEqual([]);
  });

  it("returns no legacy link for a non-default feed", async () => {
    const { dependencies, legacyLookups } = makeGetDependencies(
      makeFeed({ id: "feed-work", isDefault: false, legacyAlias: true }),
    );

    const response = await handleGetIcalFeedRoute(
      { params: { id: "feed-work" }, userId: "user-1" },
      dependencies,
    );

    expect(await readJson(response)).not.toHaveProperty("legacyIcalUrl");
    expect(legacyLookups).toEqual([]);
  });

  it("returns 404 for a feed owned by someone else", async () => {
    const { dependencies } = makeGetDependencies(null);

    const response = await handleGetIcalFeedRoute(
      { params: { id: "feed-of-user-1" }, userId: "user-2" },
      dependencies,
    );

    expect(response.status).toBe(404);
  });
});

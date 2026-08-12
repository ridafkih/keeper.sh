import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { resolveFeedIdentifier } from "../../src/utils/ical";
import type { ResolveFeedIdentifierDependencies, ResolvedFeed } from "../../src/utils/ical";
import type { FeedSettings } from "../../src/utils/ical-format";

const makeFeed = (overrides: Partial<ResolvedFeed> = {}): ResolvedFeed => ({
  feedId: "feed-1",
  userId: "user-1",
  legacyAlias: false,
  settings: { ...DEFAULT_FEED_SETTINGS } as FeedSettings,
  ...overrides,
});

const VICTIM_TOKEN = `feed_${"a".repeat(64)}`;

describe("resolveFeedIdentifier", () => {
  it("resolves a feed token before ever looking at usernames", async () => {
    const calls: string[] = [];
    const tokenOwnerFeed = makeFeed({ feedId: "feed-victim", userId: "user-victim" });

    const resolved = await resolveFeedIdentifier(VICTIM_TOKEN, {
      findFeedByToken: (token) => {
        calls.push("findFeedByToken");
        if (token !== VICTIM_TOKEN) {
          return Promise.resolve(null);
        }
        return Promise.resolve(tokenOwnerFeed);
      },
      resolveUserIdentifier: () => {
        calls.push("resolveUserIdentifier");
        return Promise.resolve("user-impersonator");
      },
      findLegacyDefaultFeed: () => {
        calls.push("findLegacyDefaultFeed");
        return Promise.resolve(makeFeed({ feedId: "feed-impersonator", userId: "user-impersonator" }));
      },
    });

    expect(resolved?.feedId).toBe("feed-victim");
    expect(calls).toEqual(["findFeedByToken"]);
  });

  it("falls back to the legacy default feed for an existing username", async () => {
    const seenIdentifiers: string[] = [];
    const legacyFeed = makeFeed({ feedId: "feed-legacy", legacyAlias: true });

    const resolved = await resolveFeedIdentifier("ada", {
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: (identifier) => {
        seenIdentifiers.push(identifier);
        return Promise.resolve("user-1");
      },
      findLegacyDefaultFeed: () => Promise.resolve(legacyFeed),
    });

    expect(resolved).toEqual(legacyFeed);
    expect(seenIdentifiers).toEqual(["ada"]);
  });

  it("falls back to the legacy default feed for a bare user id", async () => {
    const legacyFeed = makeFeed({ feedId: "feed-legacy", userId: "user-42", legacyAlias: true });

    const resolved = await resolveFeedIdentifier("user-42", {
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: (identifier) => {
        if (identifier !== "user-42") {
          return Promise.resolve(null);
        }
        return Promise.resolve("user-42");
      },
      findLegacyDefaultFeed: (userId) => {
        if (userId !== "user-42") {
          return Promise.resolve(null);
        }
        return Promise.resolve(legacyFeed);
      },
    });

    expect(resolved).toEqual(legacyFeed);
  });

  it("does not resolve a username for a user created after the migration", async () => {
    const resolved = await resolveFeedIdentifier("newcomer", {
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve("user-new"),
      findLegacyDefaultFeed: () => Promise.resolve(null),
    });

    expect(resolved).toBeNull();
  });

  it("returns null when nothing matches the identifier", async () => {
    const resolved = await resolveFeedIdentifier("nobody", {
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve(null),
      findLegacyDefaultFeed: () => Promise.resolve(makeFeed()),
    });

    expect(resolved).toBeNull();
  });

  it("does not accept an api token as a feed token", async () => {
    const resolved = await resolveFeedIdentifier(`kpr_${"b".repeat(64)}`, {
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve(null),
      findLegacyDefaultFeed: () => Promise.resolve(makeFeed()),
    });

    expect(resolved).toBeNull();
  });

  it("never reaches for a feed-creating dependency on the public path", async () => {
    const accessed: string[] = [];
    const dependencies = new Proxy({
      findFeedByToken: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve(null),
      findLegacyDefaultFeed: () => Promise.resolve(null),
      ensureDefaultFeed: () => Promise.reject(new Error("the public feed path must not write")),
      insertFeed: () => Promise.reject(new Error("the public feed path must not write")),
    }, {
      get(target, property: string, receiver) {
        accessed.push(property);
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as unknown as ResolveFeedIdentifierDependencies;

    await resolveFeedIdentifier("nobody", dependencies);

    expect(accessed).not.toContain("ensureDefaultFeed");
    expect(accessed).not.toContain("insertFeed");
  });
});

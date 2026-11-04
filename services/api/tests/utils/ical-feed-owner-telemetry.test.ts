import { describe, expect, it, vi } from "vitest";

const values: Record<string, unknown> = {};

vi.mock("@/utils/logging", () => ({
  widelog: {
    set: (key: string, value: unknown) => {
      values[key] = value;
    },
  },
}));

const { recordResolvedFeed } = await import("@/utils/ical");

describe("recordResolvedFeed", () => {
  it("attributes a feed request to the feed's owner so feed-only users count as active", () => {
    recordResolvedFeed({ feedId: "feed-1", legacyAlias: false, userId: "user-1" });

    expect(values).toEqual({
      "feed.id": "feed-1",
      "feed.legacy_identifier": false,
      "user.id": "user-1",
    });
  });
});

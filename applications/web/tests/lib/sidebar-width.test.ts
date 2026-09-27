import { describe, expect, it } from "vitest";
import { isFullScreenPath, isSyncDetailPath, isWideSidebarPath } from "../../src/lib/sidebar-width";

describe("isWideSidebarPath", () => {
  it("widens the new-sync editor and nothing else", () => {
    expect(isWideSidebarPath("/dashboard/syncs/new")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncs/new/")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncs")).toBe(false);
    expect(isWideSidebarPath("/dashboard/syncs/sync-1")).toBe(false);
    expect(isWideSidebarPath("/dashboard")).toBe(false);
    expect(isWideSidebarPath("/dashboard/setup")).toBe(false);
  });
});

describe("isSyncDetailPath", () => {
  it("matches a single sync's page only", () => {
    expect(isSyncDetailPath("/dashboard/syncs/sync-1")).toBe(true);
    expect(isSyncDetailPath("/dashboard/syncs/sync-1/")).toBe(true);
    expect(isSyncDetailPath("/dashboard/syncs")).toBe(false);
    expect(isSyncDetailPath("/dashboard/syncs/new")).toBe(false);
    expect(isSyncDetailPath("/dashboard/syncs/sync-1/extra")).toBe(false);
    expect(isSyncDetailPath("/dashboard/syncsets/sync-1")).toBe(false);
  });
});

describe("isFullScreenPath", () => {
  it("gives onboarding the whole window and keeps every other page in the sidebar", () => {
    expect(isFullScreenPath("/dashboard/setup")).toBe(true);
    expect(isFullScreenPath("/dashboard/setup/")).toBe(true);
    expect(isFullScreenPath("/dashboard")).toBe(false);
    expect(isFullScreenPath("/dashboard/syncs/new")).toBe(false);
  });
});

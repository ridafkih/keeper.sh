import { describe, expect, it } from "vitest";
import {
  isFullScreenPath,
  isSyncsListPath,
  resolveSidebarPagePath,
  resolveSyncPane,
} from "../../src/lib/sidebar-width";

describe("resolveSyncPane", () => {
  it("opens a single sync's page or the new-sync editor in the pane", () => {
    expect(resolveSyncPane("/dashboard/syncs/sync-1")).toEqual({ kind: "sync", syncId: "sync-1" });
    expect(resolveSyncPane("/dashboard/syncs/sync-1/")).toEqual({ kind: "sync", syncId: "sync-1" });
    expect(resolveSyncPane("/dashboard/syncs/new")).toEqual({ kind: "new" });
    expect(resolveSyncPane("/dashboard/syncs/new/")).toEqual({ kind: "new" });
    expect(resolveSyncPane("/dashboard/syncs")).toBeNull();
    expect(resolveSyncPane("/dashboard/syncs/sync-1/extra")).toBeNull();
    expect(resolveSyncPane("/dashboard/syncsets/sync-1")).toBeNull();
    expect(resolveSyncPane("/dashboard")).toBeNull();
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

describe("resolveSidebarPagePath", () => {
  it("treats every sync pane as the syncs list so the sidebar stays put between them", () => {
    expect(resolveSidebarPagePath("/dashboard/syncs/sync-1")).toBe("/dashboard/syncs");
    expect(resolveSidebarPagePath("/dashboard/syncs/sync-2")).toBe("/dashboard/syncs");
    expect(resolveSidebarPagePath("/dashboard/syncs/new")).toBe("/dashboard/syncs");
    expect(resolveSidebarPagePath("/dashboard/syncs/")).toBe("/dashboard/syncs");
    expect(resolveSidebarPagePath("/dashboard")).toBe("/dashboard");
    expect(isSyncsListPath("/dashboard/syncs/")).toBe(true);
    expect(isSyncsListPath("/dashboard/syncs/sync-1")).toBe(false);
  });
});

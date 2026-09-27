import { describe, expect, it } from "vitest";
import { isWideSidebarPath } from "../../src/lib/sidebar-width";

describe("isWideSidebarPath", () => {
  it("widens the sync pages and nothing else", () => {
    expect(isWideSidebarPath("/dashboard/syncs")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncs/")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncs/sync-1")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncs/new")).toBe(true);
    expect(isWideSidebarPath("/dashboard/syncsets")).toBe(false);
    expect(isWideSidebarPath("/dashboard")).toBe(false);
    expect(isWideSidebarPath("/dashboard/setup")).toBe(false);
  });
});

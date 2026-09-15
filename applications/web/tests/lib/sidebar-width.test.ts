import { describe, expect, it } from "vitest";
import { isWideSidebarPath } from "../../src/lib/sidebar-width";

describe("isWideSidebarPath", () => {
  it("widens the rules pages and nothing else", () => {
    expect(isWideSidebarPath("/dashboard/rules")).toBe(true);
    expect(isWideSidebarPath("/dashboard/rules/")).toBe(true);
    expect(isWideSidebarPath("/dashboard/rules/rule-1")).toBe(true);
    expect(isWideSidebarPath("/dashboard/rules/pairs/a/b")).toBe(true);
    expect(isWideSidebarPath("/dashboard/rulesets")).toBe(false);
    expect(isWideSidebarPath("/dashboard")).toBe(false);
    expect(isWideSidebarPath("/dashboard/setup")).toBe(false);
  });
});

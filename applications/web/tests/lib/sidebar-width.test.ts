import { describe, expect, it } from "vitest";
import { isWideSidebarPath } from "../../src/lib/sidebar-width";

describe("isWideSidebarPath", () => {
  it("widens only the rules page", () => {
    expect(isWideSidebarPath("/dashboard/rules")).toBe(true);
    expect(isWideSidebarPath("/dashboard/rules/")).toBe(true);
    expect(isWideSidebarPath("/dashboard")).toBe(false);
    expect(isWideSidebarPath("/dashboard/setup")).toBe(false);
  });
});

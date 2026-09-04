import { describe, expect, it } from "vitest";
import { resolveSidebarDirection } from "../../src/lib/sidebar-transition";

const at = (pathname: string, index: number) => ({ pathname, index });

describe("resolveSidebarDirection", () => {
  const cases = [
    { name: "push deeper", from: at("/dashboard", 0), to: at("/dashboard/settings", 1), expected: "forward" },
    { name: "push deeper twice", from: at("/dashboard/settings", 1), to: at("/dashboard/settings/passkeys", 2), expected: "forward" },
    { name: "push sibling", from: at("/dashboard/report", 1), to: at("/dashboard/feedback", 2), expected: "forward" },
    { name: "history back", from: at("/dashboard/settings", 1), to: at("/dashboard", 0), expected: "back" },
    { name: "history back to a deeper page", from: at("/dashboard", 2), to: at("/dashboard/settings", 1), expected: "back" },
    { name: "push to an ancestor", from: at("/dashboard/settings/passkeys", 0), to: at("/dashboard", 1), expected: "back" },
    { name: "replace deeper", from: at("/dashboard/accounts/a", 1), to: at("/dashboard/accounts/a/setup", 1), expected: "forward" },
    { name: "replace to an ancestor", from: at("/dashboard/upgrade", 1), to: at("/dashboard", 1), expected: "back" },
    { name: "ignores trailing slashes", from: at("/dashboard/settings/", 1), to: at("/dashboard/", 2), expected: "back" },
    { name: "prefix that is not a segment boundary", from: at("/dashboard/settings-x", 1), to: at("/dashboard/settings", 2), expected: "forward" },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.name} -> ${testCase.expected}`, () => {
      expect(resolveSidebarDirection(testCase.from, testCase.to)).toBe(testCase.expected);
    });
  }
});

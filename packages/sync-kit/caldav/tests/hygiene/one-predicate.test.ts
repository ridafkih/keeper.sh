import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { marchWindow } from "../support/harness";
import { filesMatchingPattern, sourceFiles } from "../support/sources";

const windowPredicate = /within[A-Za-z]*Window\s*(?::|=)/;

describe("there is one window predicate in this package", () => {
  test("DAV-H11: src contains exactly one window predicate", async () => {
    const definitions = await filesMatchingPattern("src", windowPredicate);
    const files = await sourceFiles("src");

    expect(definitions).toEqual(["src/window/membership.ts"]);
    expect(files).toContain("src/window/membership.ts");
  });

  test("DAV-H11: the one predicate answers for a timed event inside and outside the window", () => {
    const inside = withinCalDAVWindow(marchWindow, {
      kind: "timed",
      start: { kind: "instant", value: "2026-03-21T09:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-21T10:00:00.000Z" },
      zone: null,
    });
    const outside = withinCalDAVWindow(marchWindow, {
      kind: "timed",
      start: { kind: "instant", value: "2019-01-01T09:00:00.000Z" },
      end: { kind: "instant", value: "2019-01-01T10:00:00.000Z" },
      zone: null,
    });

    expect(inside).toBe(true);
    expect(outside).toBe(false);
  });
});

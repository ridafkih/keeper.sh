import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TWO_WAY_EDIT_ABSOLUTE_CEILING } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";

/*
 * The count is taken over the receiving calendar, across every calendar copied into it,
 * because a batch spread thinly across several sources is the shape the ceiling exists to
 * catch. Stating it as a per-calendar rule would hand the user a number twice the one the
 * classifier holds at whenever two calendars share a receiving calendar.
 */
const DOC = readFileSync(
  join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx"),
  "utf8",
);

describe("what the two-way sync page says the ceiling is counted over", () => {
  it("says the count is taken across every calendar sharing the receiving calendar", () => {
    expect(DOC).toContain(String(TWO_WAY_EDIT_ABSOLUTE_CEILING));
    expect(DOC).toContain("across every calendar copied into it, and not per calendar");
  });

  it("does not promise the ceiling applies to one calendar alone", () => {
    expect(DOC).not.toContain("counted per calendar");
  });
});

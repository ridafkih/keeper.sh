import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TWO_WAY_WRITE_BACK_DAILY_CAP } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

/*
 * The half of the defence a person is most likely to walk into: a run of write-backs to one
 * event reads as the destination generating changes by itself. The status line the user
 * meets afterwards must not tell them their copies changed on their own.
 */
const DOC = readFileSync(
  join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx"),
  "utf8",
);

describe("what the two-way sync page says about editing one copy repeatedly", () => {
  it("names how many times one copy may be edited in a day", () => {
    expect(DOC).toContain(String(TWO_WAY_WRITE_BACK_DAILY_CAP));
  });

  it("says what repeatedly editing one copy costs", () => {
    expect(DOC).toMatch(/one copy edited over and over/i);
    expect(DOC.toLowerCase()).toContain("paus");
  });

  it("does not tell the user their copies changed on their own", () => {
    expect(WRITE_BACK_STATE_COPY.runaway_write_back)
      .not.toMatch(/changed on (their|its) own/i);
  });

  it("names editing the same copy over and over as a way to reach it", () => {
    expect(WRITE_BACK_STATE_COPY.runaway_write_back?.toLowerCase())
      .toContain("same");
  });
});

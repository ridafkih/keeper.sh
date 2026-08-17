import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * packages/calendar/tests/core/sync/ pins the behaviour: the rule is applied per axis, so
 * only what the original changed is taken back. The settings page links here rather than
 * restating it, which makes this page the only place the user is told, and a promise that
 * the copy's edit is discarded whenever the original changed at all would be read as
 * "nothing is written to the original" in exactly the case where something is.
 */
const DOC = readFileSync(
  join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx"),
  "utf8",
);

describe("what the two-way sync page says about both sides changing", () => {
  it("tells the user which side wins when the original changed too", () => {
    expect(DOC).toMatch(/if the original .*(also |was )?(edit|chang)/i);
  });

  it("says the edit on the copy is replaced rather than written back", () => {
    expect(DOC).toMatch(/replac|overwrit|lost/i);
  });

  it("does not promise the copy's edit is discarded whenever the original changed at all", () => {
    expect(DOC).toMatch(/on whatever it changed|for each thing the original changed/i);
  });
});

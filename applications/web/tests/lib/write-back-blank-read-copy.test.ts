import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

const TWO_WAY_DOC = join(import.meta.dirname, "../../src/content/docs/two-way-sync.mdx");

const BLANK_READ_COPY = WRITE_BACK_STATE_COPY.all_copies_missing ?? "";

/*
 * The sentence the user answers "Delete the originals" to. A read that returned nothing at
 * all has two causes and Keeper.sh cannot tell them apart: the copies were deleted, or the
 * connection to the destination is broken. Stating only the first tells the user the copies
 * are gone, and then asks them to authorise deleting real events on that footing.
 */
describe("the sentence about copies that vanished names both of its causes", () => {
  it("does not state the copies are gone as a fact", () => {
    expect(BLANK_READ_COPY).not.toContain("Every copy on {destination} is gone.");
  });

  it("names what Keeper.sh actually did, which is read the destination", () => {
    expect(BLANK_READ_COPY.toLowerCase()).toMatch(/read|listing/u);
  });

  it("names the broken connection as the other cause", () => {
    expect(BLANK_READ_COPY.toLowerCase()).toContain("connection");
  });

  it("still says nothing on the source was deleted", () => {
    expect(BLANK_READ_COPY).toContain("has not deleted the originals on {source}");
  });

  it("still says two-way sync is held while it waits", () => {
    expect(BLANK_READ_COPY.toLowerCase())
      .toContain("two-way sync to {destination} is paused");
    expect(BLANK_READ_COPY).toContain("not written back to {source}");
    expect(BLANK_READ_COPY).toContain("the copies are left as they are");
  });
});

/*
 * The documentation repeats the rule the dashboard enforces, and a user reading it is
 * deciding whether to turn deletions on at all. It has to say the answer is not offered on
 * a blank read alone, and it has to give the route out for a destination legitimately
 * emptied — otherwise that user is simply stuck.
 */
describe("the documentation agrees with what the dashboard now offers", () => {
  const doc = readFileSync(TWO_WAY_DOC, "utf8");

  it("no longer promises the question is asked whenever every copy is gone", () => {
    expect(doc).not.toContain("Every copy on the receiving calendar is gone at once.");
  });

  it("says a reading that returned nothing may be a broken connection", () => {
    expect(doc.toLowerCase()).toContain("broken connection");
  });

  it("says the deletion is only offered after a reading that returned something", () => {
    expect(doc).toContain("reading that comes back with at least one copy");
  });

  it("gives the way out for a receiving calendar you really did empty", () => {
    expect(doc).toContain("put the copies back");
  });
});

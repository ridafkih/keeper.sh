import { describe, expect, it } from "vitest";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

/*
 * The three reasons that put a pair into delete_confirmation_required. The state keeps the
 * pair's mode, so the dashboard goes on rendering "Two-way, including deletions" as
 * selected and its field summary goes on saying edits reach the original — while the pass
 * writes nothing back for any event of that connection and holds every copy where it is
 * (packages/calendar/src/core/sync/write-back.ts, the policy.paused branch of
 * runMappingPass). A status line that names only the copies that vanished leaves the user
 * believing the rest of the connection still works both ways.
 */
const HELD_REASONS = ["all_copies_missing", "delete_breaker_tripped", "delete_probe_blocked"];

describe("a pause waiting on a delete answer says two-way sync has stopped meanwhile", () => {
  it.each(HELD_REASONS)("says two-way sync is paused for %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]?.toLowerCase()).toContain(
      "two-way sync to {destination} is paused",
    );
  });

  it.each(HELD_REASONS)("says changes on the copies are not written back for %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]).toContain("not written back to {source}");
  });

  it.each(HELD_REASONS)("says the copies are left where they are for %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]).toContain("the copies are left as they are");
  });
});

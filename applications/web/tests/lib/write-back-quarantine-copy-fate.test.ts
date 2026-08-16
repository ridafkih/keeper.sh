import { describe, expect, it } from "vitest";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

/*
 * A quarantine resolves the pair's mode to "off" (packages/calendar/src/core/sync/
 * write-back-policy.ts), so the next one-way pass rebuilds every copy from the source and
 * the change the user made on the copy is gone. A pause that only says "nothing on
 * {source} was touched" reads as the opposite — as the change sitting on the copy waiting
 * for the pause to be lifted — so every quarantine reason has to say where the copy ends up.
 *
 * The delete_confirmation_required reasons are deliberately absent: that state keeps the
 * mode and holds every mapping of the pair, so none of their copies are rebuilt.
 * delete_probe_blocked is one of them — packages/sync/src/write-back-pass.ts hands it to
 * requestDeleteConfirmation, which stores delete_confirmation_required.
 */
const QUARANTINE_REASONS = [
  "bulk_edit_breaker",
  "delete_daily_cap",
  "plan_downgraded",
  "runaway_write_back",
  "source_event_has_attendees",
  "source_event_rich_body",
  "source_write_refused",
  "write_back_failing",
];

const HELD_REASONS = [
  "all_copies_missing",
  "delete_breaker_tripped",
  "delete_probe_blocked",
];

const COPY_FATE = "go back to matching {source}";

describe("a pause that reverts to one-way says the copies revert with it", () => {
  it.each(QUARANTINE_REASONS)("tells the user what happens to the copy for %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]).toContain(COPY_FATE);
  });

  it.each(HELD_REASONS)("does not claim the copies revert for %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]).not.toContain(COPY_FATE);
  });
});

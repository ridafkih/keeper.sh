import { describe, expect, it } from "vitest";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

/*
 * Every reason the sync layer can persist into writeBackStateReason. A pause the dashboard
 * has no sentence for renders as "Two-way sync is paused." with no cause, no named event
 * and no answer buttons, and the only affordance left — re-picking the mode — clears the
 * quarantine so the next pass can set it again. The sources are
 * packages/sync/src/write-back-pass.ts (QUARANTINE_REASONS_BY_REFUSAL and the
 * resolveQuarantineReason fallback) and the pass's own stop reasons.
 */
const PERSISTED_REASONS = [
  "all_copies_missing",
  "bulk_edit_breaker",
  "delete_breaker_tripped",
  "delete_daily_cap",
  "delete_probe_blocked",
  "plan_downgraded",
  "runaway_write_back",
  "source_event_has_attendees",
  "source_event_rich_body",
  "source_write_refused",
  "write_back_failing",
];

describe("the dashboard explains every pause the sync layer can record", () => {
  it.each(PERSISTED_REASONS)("explains %s", (reason) => {
    expect(WRITE_BACK_STATE_COPY[reason]).toBeTypeOf("string");
  });
});

import { describe, expect, it } from "vitest";
import { HttpError } from "../../../src/lib/fetcher";
import { STALE_SYNC_MESSAGE, isStaleSyncError, resolveSyncError } from "../../../src/features/syncs/sync-errors";

const names = new Map([
  ["work", { id: "work", name: "Work" }],
  ["personal", { id: "personal", name: "Personal" }],
]);

const failed = (status: number, body: unknown) => new HttpError(status, "/api/syncs/s1", body);

describe("resolveSyncError", () => {
  it("names the calendar link another sync already owns", () => {
    const error = failed(409, {
      conflicts: [{ destinationCalendarId: "personal", sourceCalendarId: "work", syncId: "s2", syncName: "Family" }],
      error: "Those calendars are already linked by another sync.",
    });
    expect(resolveSyncError(error, "Failed.", names)).toBe("Work → Personal is already in Family. A calendar can only copy into another through one sync.");
  });

  it("explains a stale save and tells it apart from a conflict", () => {
    const error = failed(409, { error: "This sync changed since you opened it.", stale: true });
    expect(isStaleSyncError(error)).toBe(true);
    expect(resolveSyncError(error, "Failed.", names)).toBe(STALE_SYNC_MESSAGE);
    expect(isStaleSyncError(failed(409, { conflicts: [], error: "x" }))).toBe(false);
  });

  it("passes on the plan and validation reasons the API gives", () => {
    expect(resolveSyncError(failed(403, { error: "Free plans copy from up to 3 calendars into up to 3." }), "Failed.", names))
      .toBe("Free plans copy from up to 3 calendars into up to 3.");
    expect(resolveSyncError(failed(403, { error: "This setting requires a Pro plan." }), "Failed.", names)).toBe("This setting requires a Pro plan.");
    expect(resolveSyncError(failed(400, { error: "Some calendars were not found." }), "Failed.", names)).toBe("Some calendars were not found.");
    expect(resolveSyncError(failed(400, null), "Failed.", names)).toBe("Keeper couldn't accept this sync. Check its calendars and rules.");
  });

  it("says a missing sync is gone, and falls back for anything that isn't an API answer", () => {
    expect(resolveSyncError(failed(404, { error: "Not found" }), "Failed.", names)).toMatch(/no longer exists/);
    expect(resolveSyncError(new TypeError("Failed to fetch"), "Failed to save this sync.", names)).toBe("Failed to save this sync.");
    expect(resolveSyncError(failed(500, { error: "Internal error" }), "Failed.", names)).toBe("Internal error");
  });
});

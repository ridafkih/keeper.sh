import { describe, expect, it } from "vitest";
import { prepareCalendarSnapshotChange } from "../../../src/ics/utils/create-snapshot";

describe("calendar snapshot preparation", () => {
  it("returns a pending change without performing persistence", async () => {
    const result = await prepareCalendarSnapshotChange(
      "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
      true,
    );

    expect(result.changed).toBe(true);
    expect(result.snapshot?.ical).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
  });

  it("does not prepare a snapshot for a missing calendar", async () => {
    await expect(prepareCalendarSnapshotChange("ignored", false)).resolves.toEqual({
      changed: false,
    });
  });

  it("does not prepare unchanged content", async () => {
    const initial = await prepareCalendarSnapshotChange("same", true);
    if (!initial.snapshot) {
      throw new Error("Expected the initial snapshot");
    }

    await expect(prepareCalendarSnapshotChange(
      "same",
      true,
      initial.snapshot.contentHash,
    )).resolves.toEqual({ changed: false });
  });
});

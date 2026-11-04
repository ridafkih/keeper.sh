import { describe, expect, it } from "vitest";
import { resolveCalDAVImportNotice } from "../../src/lib/caldav-import-notice";

const calendars = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("resolveCalDAVImportNotice", () => {
  it("stays quiet when every calendar is newly added", () => {
    expect(resolveCalDAVImportNotice(calendars("imported", "imported"))).toBeNull();
  });

  it("says the calendars were already connected when none were added", () => {
    expect(resolveCalDAVImportNotice(calendars("already_connected"))).toBe("Already connected");
    expect(
      resolveCalDAVImportNotice(calendars("already_connected", "already_connected")),
    ).toBe("Already connected");
  });

  it("counts what was added and what was already there", () => {
    expect(
      resolveCalDAVImportNotice(calendars("imported", "imported", "already_connected")),
    ).toBe("2 calendars added, 1 already connected");
    expect(
      resolveCalDAVImportNotice(calendars("imported", "already_connected", "already_connected")),
    ).toBe("1 calendar added, 2 already connected");
  });

  it("stays quiet when the response carries no calendars it understands", () => {
    expect(resolveCalDAVImportNotice(undefined)).toBeNull();
    expect(resolveCalDAVImportNotice([{ status: 3 }])).toBeNull();
  });
});

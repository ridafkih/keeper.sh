import { describe, expect, it } from "vitest";
import {
  isCalDAVPrivilegeSetWritable,
  isGoogleAccessRoleWritable,
  isOutlookCalendarWritable,
  resolveCalendarCapabilities,
} from "../../../src/core/source/calendar-capabilities";
import {
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
} from "../../../src/core/source/calendar-rediscovery";

describe("calendar capabilities", () => {
  it("grants push only to Google calendars the user can write", () => {
    expect(isGoogleAccessRoleWritable("owner")).toBe(true);
    expect(isGoogleAccessRoleWritable("writer")).toBe(true);
    expect(isGoogleAccessRoleWritable("reader")).toBe(false);
    expect(isGoogleAccessRoleWritable("freeBusyReader")).toBe(false);
  });

  it("grants push only to Outlook calendars that report canEdit", () => {
    expect(isOutlookCalendarWritable(true)).toBe(true);
    expect(isOutlookCalendarWritable(false)).toBe(false);
    expect(isOutlookCalendarWritable()).toBe(false);
  });

  it("reads CalDAV write access from the current user privilege set", () => {
    expect(isCalDAVPrivilegeSetWritable(["read", "write"])).toBe(true);
    expect(isCalDAVPrivilegeSetWritable(["all"])).toBe(true);
    expect(isCalDAVPrivilegeSetWritable(["read", "bind"])).toBe(true);
    expect(isCalDAVPrivilegeSetWritable(["read", "write-content"])).toBe(false);
    expect(isCalDAVPrivilegeSetWritable(["read"])).toBe(false);
  });

  it("treats a CalDAV server that reports no privilege set as writable", () => {
    expect(isCalDAVPrivilegeSetWritable(null)).toBe(true);
  });

  it("maps writability to stored capabilities", () => {
    expect(resolveCalendarCapabilities(true)).toEqual(["pull", "push"]);
    expect(resolveCalendarCapabilities(false)).toEqual(["pull"]);
  });

  it("discovers read-only calendars as not writable on every provider", () => {
    expect(toDiscoveredGoogleCalendars([
      { accessRole: "reader", id: "holidays", summary: "Holidays" },
    ])[0]?.writable).toBe(false);
    expect(toDiscoveredOutlookCalendars([
      { canEdit: false, id: "shared", name: "Shared" },
    ])[0]?.writable).toBe(false);
    expect(toDiscoveredCalDAVCalendars([
      { displayName: "Subscribed", url: "https://dav.example.com/cal/subscribed/", writable: false },
    ])[0]?.writable).toBe(false);
  });
});

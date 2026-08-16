import { describe, expect, it } from "vitest";
import { resolveWritableWriteBackMode } from "../src/index";

const WRITABLE = ["pull", "push"];

/*
 * The gate that made the writer's authorship guard reachable in production: a CalDAV
 * source whose login carries no "@" was forced to "off" before any writer ran, so two-way
 * sync was not merely refused per event on Nextcloud, Radicale, Baikal, Synology and
 * Zimbra — it was never offered. The guard is gone and so is the reason for this gate.
 */
describe("a source with no address to name the account by", () => {
  it("keeps the requested mode for a writable CalDAV calendar", () => {
    expect(resolveWritableWriteBackMode("edits", {
      calendarType: "caldav",
      capabilities: WRITABLE,
    })).toBe("edits");
  });

  it("keeps the deleting mode for a writable CalDAV calendar", () => {
    expect(resolveWritableWriteBackMode("edits_and_deletes", {
      calendarType: "caldav",
      capabilities: WRITABLE,
      writeBackIdentity: "nextcloud-admin",
    })).toBe("edits_and_deletes");
  });
});

/*
 * The refusals the removal must not take with it. Each of these is a source Keeper.sh
 * genuinely cannot write to, and each has its own sentence on the dashboard.
 */
describe("the refusals that are not about identity", () => {
  it("still refuses a calendar added by link", () => {
    expect(resolveWritableWriteBackMode("edits", {
      calendarType: "ical",
      capabilities: WRITABLE,
    })).toBe("off");
  });

  it("still refuses a calendar shared without write access", () => {
    expect(resolveWritableWriteBackMode("edits", {
      calendarType: "caldav",
      capabilities: ["pull"],
    })).toBe("off");
  });

  it("still refuses a paused calendar", () => {
    expect(resolveWritableWriteBackMode("edits", {
      calendarType: "caldav",
      capabilities: WRITABLE,
      disabled: true,
    })).toBe("off");
  });

  it("still refuses when there is no source at all", () => {
    expect(resolveWritableWriteBackMode("edits", null)).toBe("off");
  });
});

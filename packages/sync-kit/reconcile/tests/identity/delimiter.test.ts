import { describe, expect, test } from "vitest";
import { eventIdentityKey } from "@keeper.sh/sync-ical";
import { calendarKeyString, sourceIdentityKey } from "../../src/index";
import { expectedCalendarKeyString, expectedSourceIdentityKey, nul } from "../support/keys";
import { masterIdentity, overrideIdentity, sourceCalendar } from "../support/fixtures";

const uidCarryingAPipe = masterIdentity("meeting|2026-03-10T09:00:00.000Z");
const collidingOverride = overrideIdentity("meeting", "2026-03-10T09:00:00.000Z");

describe("the delimiter cannot appear in the fields it separates", () => {
  test("RECON-O29: two identities that collide under a pipe join stay distinct under ours", () => {
    expect(sourceIdentityKey(uidCarryingAPipe)).not.toBe(sourceIdentityKey(collidingOverride));
  });

  test("RECON-O29: the latent collision in sync-ical's pipe-joined key is real, which is why it is not reused", () => {
    expect(eventIdentityKey(uidCarryingAPipe)).toBe("master|meeting|2026-03-10T09:00:00.000Z");
    expect(eventIdentityKey(collidingOverride)).toBe("override|meeting|2026-03-10T09:00:00.000Z");
  });

  test("RECON-I10: the identity key joins on NUL", () => {
    expect(sourceIdentityKey(collidingOverride)).toBe(expectedSourceIdentityKey(collidingOverride));
    expect(sourceIdentityKey(collidingOverride).includes(nul)).toBe(true);
  });

  test("RECON-I10: the calendar key joins on NUL too", () => {
    expect(calendarKeyString(sourceCalendar)).toBe(expectedCalendarKeyString(sourceCalendar));
    expect(calendarKeyString(sourceCalendar).includes(nul)).toBe(true);
  });

  test("RECON-I10: neither key builder emits a colon or a pipe as a separator", () => {
    const key = sourceIdentityKey(collidingOverride);

    expect(key.split(nul)).toHaveLength(3);
    expect(calendarKeyString(sourceCalendar).split(nul)).toHaveLength(3);
  });

  test("RECON-O29: two calendars whose fields concatenate identically stay distinct", () => {
    const left = { ...sourceCalendar, account: { kind: "accountId" as const, value: "a" }, calendar: { kind: "calendarId" as const, value: "b:c" } };
    const right = { ...sourceCalendar, account: { kind: "accountId" as const, value: "a:b" }, calendar: { kind: "calendarId" as const, value: "c" } };

    expect(calendarKeyString(left)).not.toBe(calendarKeyString(right));
  });
});

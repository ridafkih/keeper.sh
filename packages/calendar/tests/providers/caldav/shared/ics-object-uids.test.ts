import { describe, expect, it } from "vitest";
import { readCalendarObjectUids } from "../../../../src/providers/caldav/shared/ics";

const calendar = (...lines: string[]): string =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");

describe("readCalendarObjectUids", () => {
  it("reads the UID of a single event", () => {
    expect(readCalendarObjectUids(calendar("BEGIN:VEVENT", "UID:abc@keeper.sh", "END:VEVENT")))
      .toEqual(["abc@keeper.sh"]);
  });

  it("reads every UID of a series with overrides", () => {
    expect(readCalendarObjectUids(calendar(
      "BEGIN:VEVENT",
      "UID:series@example.com",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series@example.com",
      "RECURRENCE-ID:20270309T140000Z",
      "END:VEVENT",
    ))).toEqual(["series@example.com", "series@example.com"]);
  });

  it("joins a UID folded across lines", () => {
    expect(readCalendarObjectUids(calendar("BEGIN:VEVENT", "UID:0123456789abcdef", " @keeper.sh", "END:VEVENT")))
      .toEqual(["0123456789abcdef@keeper.sh"]);
  });

  it("reads a UID that carries parameters, in any letter case, with bare line feeds", () => {
    expect(readCalendarObjectUids("BEGIN:VEVENT\nuid;X-PARAM=1:abc@keeper.sh\nEND:VEVENT"))
      .toEqual(["abc@keeper.sh"]);
  });

  it("does not read a UID out of another property's text", () => {
    expect(readCalendarObjectUids(calendar(
      "BEGIN:VEVENT",
      "UID:owner@example.com",
      "DESCRIPTION:UID:fake@keeper.sh",
      "X-UID:other@keeper.sh",
      "END:VEVENT",
    ))).toEqual(["owner@example.com"]);
  });

  it("returns nothing for an object without a UID", () => {
    expect(readCalendarObjectUids(calendar("BEGIN:VEVENT", "SUMMARY:Untitled", "END:VEVENT"))).toEqual([]);
  });
});

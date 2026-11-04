import { describe, expect, it } from "vitest";
import {
  readDeclaredCalendarName,
  resolveFeedName,
  resolveRefreshedFeedNames,
} from "../../../src/ics/utils/feed-name";

const buildCalendar = (...properties: string[]): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    ...properties,
    "BEGIN:VEVENT",
    "UID:event-1",
    "NAME:Event-level name",
    "SUMMARY:Standup",
    "DTSTART:20261103T150000Z",
    "DTEND:20261103T153000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

describe("readDeclaredCalendarName", () => {
  it("reads X-WR-CALNAME", () => {
    expect(readDeclaredCalendarName(buildCalendar("X-WR-CALNAME:Holidays in Canada")))
      .toBe("Holidays in Canada");
  });

  it("prefers X-WR-CALNAME over NAME", () => {
    expect(readDeclaredCalendarName(buildCalendar("NAME:Team", "X-WR-CALNAME:Work")))
      .toBe("Work");
  });

  it("falls back to the calendar's NAME property", () => {
    expect(readDeclaredCalendarName(buildCalendar("NAME;LANGUAGE=en:Team rota")))
      .toBe("Team rota");
  });

  it("unfolds and unescapes the value", () => {
    expect(readDeclaredCalendarName(buildCalendar(String.raw`X-WR-CALNAME:Family\, frie`, " nds")))
      .toBe("Family, friends");
  });

  it("ignores names declared inside components", () => {
    expect(readDeclaredCalendarName(buildCalendar())).toBeNull();
  });

  it("ignores a blank name", () => {
    expect(readDeclaredCalendarName(buildCalendar("X-WR-CALNAME:  ", "NAME:Team")))
      .toBe("Team");
  });
});

describe("resolveFeedName", () => {
  it("uses the declared name", () => {
    expect(resolveFeedName(buildCalendar("X-WR-CALNAME:Work"), "https://example.com/a.ics"))
      .toBe("Work");
  });

  it("falls back to the URL host without credentials or www", () => {
    expect(resolveFeedName(buildCalendar(), "https://user:pass@www.example.com/a.ics"))
      .toBe("example.com");
  });

  it("reads the host of a webcal link", () => {
    expect(resolveFeedName(buildCalendar(), "webcal://calendar.example.org/feed"))
      .toBe("calendar.example.org");
  });
});

describe("resolveRefreshedFeedNames", () => {
  const url = "https://example.com/a.ics";

  it("follows a renamed feed when the source still carries the feed's name", () => {
    expect(resolveRefreshedFeedNames(
      { name: "Work", originalName: "Work", url },
      buildCalendar("X-WR-CALNAME:Work calendar"),
    )).toEqual({ name: "Work calendar", originalName: "Work calendar" });
  });

  it("replaces the old placeholder name on sources imported before feed names", () => {
    expect(resolveRefreshedFeedNames(
      { name: "iCal Feed", originalName: null, url },
      buildCalendar("X-WR-CALNAME:Holidays in Canada"),
    )).toEqual({ name: "Holidays in Canada", originalName: "Holidays in Canada" });
  });

  it("keeps a name the user chose", () => {
    expect(resolveRefreshedFeedNames(
      { name: "My holidays", originalName: "Holidays", url },
      buildCalendar("X-WR-CALNAME:Holidays in Canada"),
    )).toEqual({ name: "My holidays", originalName: "Holidays in Canada" });
  });

  it("changes nothing when the feed name is unchanged", () => {
    expect(resolveRefreshedFeedNames(
      { name: "Work", originalName: "Work", url },
      buildCalendar("X-WR-CALNAME:Work"),
    )).toBeNull();
  });
});

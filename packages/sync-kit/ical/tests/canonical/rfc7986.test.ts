import { describe, expect, test } from "vitest";
import { calendarWith, vevent } from "../support/feed";
import { soleFingerprint } from "../support/canonical";

const baseLines = [
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260310T090000Z",
  "DTEND:20260310T100000Z",
  "SUMMARY:decorated",
] as const;

const decorated = (extra: string): string =>
  calendarWith([...vevent({ uid: "evt-decorated", lines: [...baseLines, extra] })]);

const decorations = [
  "COLOR:turquoise",
  "IMAGE;VALUE=URI;DISPLAY=BADGE:https://example.com/badge.png",
  "CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://example.com/meet/1",
] as const;

describe("RFC 7986 decoration a provider may drop on export", () => {
  for (const decoration of decorations) {
    test(`ICAL-O42: adding ${decoration.split(";")[0]?.split(":")[0]} does not change the fingerprint`, () => {
      const plain = calendarWith([...vevent({ uid: "evt-decorated", lines: [...baseLines] })]);
      const baseline = soleFingerprint(plain);

      expect(baseline).not.toBe("none");
      expect(soleFingerprint(decorated(decoration))).toBe(baseline);
    });
  }

  test("ICAL-I35: all three decorations together still hash as the undecorated event", () => {
    const plain = calendarWith([...vevent({ uid: "evt-decorated", lines: [...baseLines] })]);
    const all = calendarWith([
      ...vevent({ uid: "evt-decorated", lines: [...baseLines, ...decorations] }),
    ]);

    expect(soleFingerprint(all)).toBe(soleFingerprint(plain));
  });
});

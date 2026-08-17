import { describe, expect, test } from "vitest";
import { parseIcsDocument, stripByteOrderMark } from "../../src/index";
import { calendarWith, simpleEvent } from "../support/feed";
import { testOptions } from "../support/options";

const body = calendarWith([...simpleEvent("evt-1", "20260310T090000Z", "20260310T100000Z")]);

describe("a UTF-8 byte order mark on the front of the body", () => {
  test("ICAL-I15: the BOM is stripped so BEGIN:VCALENDAR is recognised", () => {
    expect(stripByteOrderMark(`﻿${body}`)).toBe(body);
  });

  test("ICAL-I15: a body without a BOM is returned untouched", () => {
    expect(stripByteOrderMark(body)).toBe(body);
  });

  test("ICAL-I15: only a leading BOM is stripped, never one inside a value", () => {
    const withInnerMark = calendarWith([
      "BEGIN:VEVENT",
      "UID:evt-1",
      "DTSTAMP:20260310T080000Z",
      "DTSTART:20260310T090000Z",
      "SUMMARY:before﻿after",
      "END:VEVENT",
    ]);

    expect(stripByteOrderMark(withInnerMark)).toContain("before﻿after");
  });

  test("ICAL-I15: a CalDAV calendar-data body carrying a BOM parses as readable", () => {
    expect(parseIcsDocument(`﻿${body}`, testOptions()).kind).toBe("readable");
  });
});

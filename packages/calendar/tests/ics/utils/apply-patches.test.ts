import { describe, expect, it } from "vitest";
import { applyIcsPatches } from "../../../src/ics/utils/apply-patches";
import type { IcsPatch } from "../../../src/ics/utils/apply-patches";

const uppercaseSummary: IcsPatch = {
  coerce(params, value) {
    return { params, value: value.toUpperCase() };
  },
  name: "uppercase-summary",
  properties: ["SUMMARY"],
  spec: "test only",
};

const declareValueDate: IcsPatch = {
  coerce(params, value) {
    if (params.length > 0) {
      return null;
    }
    if (!/^\d{8}$/.test(value)) {
      return null;
    }
    return { params: ";VALUE=DATE", value };
  },
  name: "declare-value-date",
  properties: ["DTSTART", "DTEND"],
  spec: "test only",
};

describe("applyIcsPatches", () => {
  it("returns the input unchanged when no patches match", () => {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"].join("\r\n");
    expect(applyIcsPatches(ics, [uppercaseSummary])).toBe(ics);
  });

  it("applies the coerce function to lines matching the patch's properties", () => {
    const ics = ["BEGIN:VEVENT", "SUMMARY:hello", "END:VEVENT"].join("\r\n");
    const result = applyIcsPatches(ics, [uppercaseSummary]);
    expect(result).toContain("SUMMARY:HELLO");
  });

  it("rewrites both params and value when the patch returns a coercion", () => {
    const ics = ["BEGIN:VEVENT", "DTSTART:20260515", "END:VEVENT"].join("\r\n");
    const result = applyIcsPatches(ics, [declareValueDate]);
    expect(result).toContain("DTSTART;VALUE=DATE:20260515");
  });

  it("ignores lines whose property is not targeted by any patch", () => {
    const ics = ["BEGIN:VEVENT", "DESCRIPTION:hello", "END:VEVENT"].join("\r\n");
    expect(applyIcsPatches(ics, [uppercaseSummary])).toContain("DESCRIPTION:hello");
  });

  it("unfolds RFC 5545 line continuations before parsing the property line", () => {
    const folded = ["BEGIN:VEVENT", "SUMMARY:hello", "  world", "END:VEVENT"].join("\r\n");
    const result = applyIcsPatches(folded, [uppercaseSummary]);
    expect(result).toContain("SUMMARY:HELLO WORLD");
  });

  it("accepts LF line endings and emits CRLF", () => {
    const ics = "BEGIN:VEVENT\nSUMMARY:hello\nEND:VEVENT";
    expect(applyIcsPatches(ics, [uppercaseSummary])).toBe(
      ["BEGIN:VEVENT", "SUMMARY:HELLO", "END:VEVENT"].join("\r\n"),
    );
  });

  it("chains multiple patches that target the same property", () => {
    const appendSentinel: IcsPatch = {
      coerce(params, value) {
        return { params, value: `${value}!` };
      },
      name: "append-sentinel",
      properties: ["SUMMARY"],
      spec: "test only",
    };
    const ics = ["BEGIN:VEVENT", "SUMMARY:hello", "END:VEVENT"].join("\r\n");
    const result = applyIcsPatches(ics, [uppercaseSummary, appendSentinel]);
    expect(result).toContain("SUMMARY:HELLO!");
  });
});

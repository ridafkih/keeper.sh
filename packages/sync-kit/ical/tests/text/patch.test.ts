import { describe, expect, test } from "vitest";
import { applyIcsPatches } from "../../src/index";
import type { IcsPatch } from "../../src/index";
import { crlf } from "../support/feed";
import { testLimits } from "../support/options";

const upperCaseSummary: IcsPatch = {
  properties: ["SUMMARY"],
  coerce: (params, value) => ({ params, value: value.toUpperCase() }),
};

const declineEverything: IcsPatch = {
  properties: ["SUMMARY"],
  coerce: () => null,
};

const patched = (body: string, patches: readonly IcsPatch[]): string => {
  const outcome = applyIcsPatches(body, patches, testLimits());
  if (outcome.kind !== "patched") {
    return "";
  }
  return outcome.text;
};

describe("applying the lenient patches", () => {
  test("ICAL-I13: lines no patch touches are re-emitted byte for byte", () => {
    const body = crlf(["BEGIN:VCALENDAR", "PRODID:-//x//y//EN", "SUMMARY:hi", "END:VCALENDAR"]);

    expect(patched(body, [upperCaseSummary])).toBe(
      crlf(["BEGIN:VCALENDAR", "PRODID:-//x//y//EN", "SUMMARY:HI", "END:VCALENDAR"]),
    );
  });

  test("ICAL-I13: LF input is accepted and CRLF is emitted", () => {
    expect(patched("BEGIN:VCALENDAR\nSUMMARY:hi\nEND:VCALENDAR\n", [upperCaseSummary])).toBe(
      crlf(["BEGIN:VCALENDAR", "SUMMARY:HI", "END:VCALENDAR"]),
    );
  });

  test("ICAL-I13: a folded property is unfolded before the patch sees its value", () => {
    const body = "BEGIN:VCALENDAR\r\nSUMMARY:hel\r\n lo\r\nEND:VCALENDAR\r\n";

    expect(patched(body, [upperCaseSummary])).toContain("SUMMARY:HELLO");
  });

  test("ICAL-I13: a folded property no patch modifies keeps its original folded form", () => {
    const body = "BEGIN:VCALENDAR\r\nDESCRIPTION:hel\r\n lo\r\nEND:VCALENDAR\r\n";

    expect(patched(body, [upperCaseSummary])).toBe(body);
  });

  test("ICAL-I13: a patch returning null leaves an earlier patch's rewrite standing", () => {
    const body = crlf(["BEGIN:VCALENDAR", "SUMMARY:hi", "END:VCALENDAR"]);

    expect(patched(body, [upperCaseSummary, declineEverything])).toContain("SUMMARY:HI");
  });

  test("ICAL-I13: a line without a colon is returned verbatim rather than dropped", () => {
    const body = crlf(["BEGIN:VCALENDAR", "GARBAGE", "END:VCALENDAR"]);

    expect(patched(body, [upperCaseSummary])).toBe(body);
  });
});

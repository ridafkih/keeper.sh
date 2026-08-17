import { describe, expect, test } from "vitest";
import { parseIcsDocument, walkComponents } from "../../src/index";
import { testLimits, testOptions } from "../support/options";

const maxComponentDepth = 16;

const nested = (depth: number): string => {
  const opens = Array.from({ length: depth }, (_unused, index) => `BEGIN:X-NEST-${index}`);
  const closes = [...opens].toReversed().map((line) => line.replace("BEGIN:", "END:"));
  return `${["BEGIN:VCALENDAR", ...opens, ...closes, "END:VCALENDAR"].join("\r\n")}\r\n`;
};

const walkSource = await Bun.file(
  new URL("../../src/text/component-walk.ts", import.meta.url),
).text();

describe("deeply nested BEGIN blocks", () => {
  test("ICAL-L5: nesting deeper than maxComponentDepth is refused", () => {
    expect(walkComponents(nested(maxComponentDepth + 1), testLimits({ maxComponentDepth }))).toEqual({
      kind: "refused",
      reason: "limitExceeded",
    });
  });

  test("ICAL-L5: the document refuses rather than overflowing the stack", () => {
    expect(parseIcsDocument(nested(100_000), testOptions({ limits: { maxComponentDepth } }))).toEqual({
      kind: "unreadable",
      reason: "limitExceeded",
    });
  });

  test("ICAL-L5: the walker never recurses, so the bound is structural rather than incidental", () => {
    expect(walkSource).not.toMatch(/\bwalkComponents\s*\(/u);
    expect(walkSource).toContain("walkComponents");
    expect(walkComponents(nested(2), testLimits({ maxComponentDepth })).kind).toBe("walked");
  });

  test("ICAL-L5: nesting at the ceiling is walked without refusal", () => {
    expect(walkComponents(nested(maxComponentDepth - 1), testLimits({ maxComponentDepth })).kind).toBe(
      "walked",
    );
  });

  test(
    "ICAL-L5: the deep refusal returns rather than running away",
    () => {
      expect(walkComponents(nested(200_000), testLimits({ maxComponentDepth }))).toEqual({
        kind: "refused",
        reason: "limitExceeded",
      });
    },
    5000,
  );
});

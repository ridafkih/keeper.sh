import { describe, expect, test } from "vitest";
import { foldContentLine, unfoldContentLines } from "../../src/index";
import { testLimits } from "../support/options";

const octetLength = (value: string): number => new TextEncoder().encode(value).length;

const unfoldOne = (folded: readonly string[]): string => {
  const outcome = unfoldContentLines(`${folded.join("\r\n")}\r\n`, testLimits());
  if (outcome.kind !== "patched") {
    return "";
  }
  return outcome.text.replace(/\r\n$/u, "");
};

describe("RFC 5545 §3.1 content-line folding", () => {
  test("ICAL-I14: every emitted line is at most 75 UTF-8 octets, excluding the line break", () => {
    const line = `DESCRIPTION:${"a".repeat(500)}`;

    for (const folded of foldContentLine(line)) {
      expect(octetLength(folded)).toBeLessThanOrEqual(75);
    }
  });

  test("ICAL-I14: folding is measured in octets, not characters, for a multi-byte value", () => {
    const line = `SUMMARY:${"é".repeat(200)}`;

    for (const folded of foldContentLine(line)) {
      expect(octetLength(folded)).toBeLessThanOrEqual(75);
    }
  });

  test("ICAL-I14: an astral-plane code point is never split across a fold", () => {
    const line = `SUMMARY:${"👨‍👩‍👧‍👦".repeat(40)}`;
    const folded = foldContentLine(line);

    expect(folded.join("").includes("�")).toBe(false);
    expect(unfoldOne(folded)).toBe(line);
  });

  test("ICAL-I14: unfold is the exact inverse of fold across an adversarial alphabet", () => {
    const alphabets = ["a", "é", "→", "👩🏽‍🚀", "𐍈"] as const;

    for (const glyph of alphabets) {
      const line = `DESCRIPTION:${glyph.repeat(97)}`;
      expect(unfoldOne(foldContentLine(line))).toBe(line);
    }
  });

  test("ICAL-I13: a continuation may begin with SPACE or HTAB, and the whitespace is removed", () => {
    const outcome = unfoldContentLines("SUMMARY:one\r\n two\r\n\tthree\r\n", testLimits());

    expect(outcome).toEqual({ kind: "patched", text: "SUMMARY:onetwothree\r\n" });
  });

  test("ICAL-I13: a line short enough to stand alone is not folded", () => {
    expect(foldContentLine("SUMMARY:short")).toEqual(["SUMMARY:short"]);
  });
});

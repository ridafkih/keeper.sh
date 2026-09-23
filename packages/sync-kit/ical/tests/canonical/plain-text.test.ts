import { describe, expect, test } from "vitest";
import { toPlainTextDescription } from "../../src/index";
import { testLimits } from "../support/options";

const depthBomb = (depth: number): string =>
  `${"<div>".repeat(depth)}payload${"</div>".repeat(depth)}`;

describe("projecting a description to plain text", () => {
  test("ICAL-L10: a 50k-deep tag nest returns a value instead of throwing or recursing", () => {
    const limits = testLimits({ maxDescriptionDepth: 64 });

    expect(() => toPlainTextDescription(depthBomb(50_000), limits)).not.toThrow();
    expect(toPlainTextDescription(depthBomb(50_000), limits)).toContain("payload");
  });

  test("ICAL-L10: maxDescriptionDepth is the bound that stopped it, not an incidental one", () => {
    const shallow = toPlainTextDescription(depthBomb(50_000), testLimits({ maxDescriptionDepth: 2 }));
    const deep = toPlainTextDescription(depthBomb(50_000), testLimits({ maxDescriptionDepth: 64 }));

    expect(shallow).not.toBe(deep);
  });

  test("ICAL-L10: the projection is idempotent, so a re-poll cannot re-strip the same text", () => {
    const limits = testLimits();
    const once = toPlainTextDescription("<p>hello <b>world</b></p>", limits);

    expect(toPlainTextDescription(once, limits)).toBe(once);
  });

  test("ICAL-L10: a nest deeper than the bound strips the same on a re-poll", () => {
    const limits = testLimits({ maxDescriptionDepth: 4 });
    const once = toPlainTextDescription(depthBomb(16), limits);

    expect(toPlainTextDescription(once, limits)).toBe(once);
    expect(once).toContain("payload");
  });

  test("ICAL-I36: an entity is decoded exactly once, never twice", () => {
    const limits = testLimits();
    const once = toPlainTextDescription("a &amp;amp; b", limits);

    expect(once).toBe("a &amp; b");
    expect(toPlainTextDescription(once, limits)).toBe(once);
  });

  test("ICAL-I36: plain text with no markup is returned unchanged", () => {
    const limits = testLimits();

    expect(toPlainTextDescription("a plain description", limits)).toBe("a plain description");
  });

  test(
    "ICAL-L10: the depth bomb terminates rather than running away",
    () => {
      expect(toPlainTextDescription(depthBomb(50_000), testLimits())).toContain("payload");
    },
    5000,
  );
});

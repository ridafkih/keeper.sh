import { describe, expect, test } from "vitest";
import { compareCanonicalUtcInstants, isCanonicalUtcInstant, translateDestinationSync } from "../../src/index";
import { instant } from "../support/handles";
import { mirrorRow, shadowOptions, slotIdentity, storedCoverage, storedSourceEvent, syncInput } from "../support/fixtures";

const canonical = ["2026-03-10T09:00:00.000Z", "1999-12-31T23:59:59.999Z", "2026-01-01T00:00:00.000Z"];

const notCanonical = [
  "2026-03-10T09:00:00Z",
  "2026-03-10T09:00:00.000+00:00",
  "2026-03-10T09:00:00.000",
  "2026-03-10 09:00:00.000Z",
  "2026-03-10T09:00:00.000z",
  "",
  "not-a-time",
];

describe("canonical UTC instants", () => {
  test("SHADOW-I30: a canonical RFC 3339 UTC instant is accepted", () => {
    for (const value of canonical) {
      expect(isCanonicalUtcInstant(instant(value))).toBe(true);
    }
  });

  test("SHADOW-I30: every other spelling of the same moment is refused", () => {
    for (const value of notCanonical) {
      expect(isCanonicalUtcInstant(instant(value))).toBe(false);
    }
  });

  test("SHADOW-I30: the order is total and lexicographic over canonical values", () => {
    const earlier = instant("2026-03-10T09:00:00.000Z");
    const later = instant("2026-03-10T09:00:00.001Z");

    expect(compareCanonicalUtcInstants(earlier, later)).toBeLessThan(0);
    expect(compareCanonicalUtcInstants(later, earlier)).toBeGreaterThan(0);
    expect(compareCanonicalUtcInstants(earlier, earlier)).toBe(0);
  });

  test("SHADOW-I30: a non-canonical instant refuses the translation", () => {
    const identity = slotIdentity("evt-odd", "2026-03-10T09:00:00Z", "2026-03-10T10:00:00.000Z");
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        storedCoverage: [storedCoverage({ recordedAt: "2026-06-15T11:30:00Z" })],
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("nonCanonicalInstant");
  });
});

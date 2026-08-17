import { describe, expect, test } from "vitest";
import { microsoftCapabilities } from "../../src/capabilities";
import { createHarness } from "../support/harness";
import { allDayContent, timedContent } from "../support/intents";

const normalizedTwice = (harness: ReturnType<typeof createHarness>, content: ReturnType<typeof timedContent>) => {
  const once = harness.provider.normalize(content);
  if (!once.ok) {
    throw new Error("normalizing a representable range refused it");
  }
  const twice = harness.provider.normalize(once.value.content);
  if (!twice.ok) {
    throw new Error("normalizing a normalized range refused it");
  }
  return { once: once.value, twice: twice.value };
};

describe("shaping a range is idempotent, so the layers cannot disagree", () => {
  test("MS-O32: normalizing a normalized range is the identity", () => {
    const harness = createHarness();

    const inverted = normalizedTwice(
      harness,
      timedContent({ start: "2026-03-21T10:00:00.000Z", end: "2026-03-21T09:00:00.000Z" }),
    );
    const zeroDuration = normalizedTwice(
      harness,
      timedContent({ start: "2026-03-21T09:00:00.000Z", end: "2026-03-21T09:00:00.000Z" }),
    );
    const allDay = normalizedTwice(harness, allDayContent("2026-03-21", "2026-03-22"));

    expect(inverted.twice).toEqual(inverted.once);
    expect(zeroDuration.twice).toEqual(zeroDuration.once);
    expect(allDay.twice).toEqual(allDay.once);
  });

  test("MS-O32: Graph's own answers to zero-duration and inverted ranges are the declared ones", () => {
    const harness = createHarness();

    const zeroDuration = harness.provider.normalize(
      timedContent({ start: "2026-03-21T09:00:00.000Z", end: "2026-03-21T09:00:00.000Z" }),
    );
    const inverted = harness.provider.normalize(
      timedContent({ start: "2026-03-21T10:00:00.000Z", end: "2026-03-21T09:00:00.000Z" }),
    );

    expect(microsoftCapabilities.representableRange.zeroDuration).toBe("accept");
    expect(zeroDuration.ok).toBe(true);
    if (!inverted.ok) {
      throw new Error("an inverted range was refused where it is declared clampToStart");
    }
    expect(inverted.value.content.time).toEqual({
      kind: "timed",
      start: { kind: "instant", value: "2026-03-21T10:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-21T10:00:00.000Z" },
      zone: { kind: "zoneId", value: "UTC" },
    });
  });
});

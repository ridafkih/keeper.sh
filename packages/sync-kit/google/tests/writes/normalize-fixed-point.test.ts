import type { EditableContent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { googleCapabilities } from "../../src/capabilities";
import { normalizeForGoogle } from "../../src/write/normalize";
import { createHarness } from "../support/harness";
import { allDayContent, timedContent } from "../support/intents";

const zeroDuration = timedContent({
  start: "2026-03-21T09:00:00.000Z",
  end: "2026-03-21T09:00:00.000Z",
});

const inverted = timedContent({
  start: "2026-03-21T10:00:00.000Z",
  end: "2026-03-21T09:00:00.000Z",
});

const offGridAllDay = allDayContent("2026-03-21", "2026-03-24");

const normalizedTwice = (
  content: EditableContent,
  hash: (input: string) => string,
): readonly [unknown, unknown] => {
  const once = normalizeForGoogle(content, hash);
  if (!once.ok) {
    return [once, once];
  }
  return [once, normalizeForGoogle(once.value.content, hash)];
};

describe("shaping happens once, at one seam, and is a fixed point", () => {
  test("GOOG-O28: normalising twice equals normalising once", () => {
    const harness = createHarness();

    const [once, twice] = normalizedTwice(offGridAllDay, harness.environment.hash);

    expect(twice).toEqual(once);
  });

  test("GOOG-O28: a zero-duration range is widened once, to the span the capability declares", () => {
    const harness = createHarness();

    const [once, twice] = normalizedTwice(zeroDuration, harness.environment.hash);
    const widened = normalizeForGoogle(zeroDuration, harness.environment.hash);

    expect(twice).toEqual(once);
    if (!widened.ok || widened.value.content.recurrence !== null) {
      throw new Error("a zero-duration range was refused rather than widened");
    }
    const { time } = widened.value.content;
    if (time.kind !== "timed") {
      throw new Error("a timed range shaped into an all-day range");
    }
    expect(Date.parse(time.end.value) - Date.parse(time.start.value)).toBe(
      googleCapabilities.representableRange.minimumSpanSeconds * 1000,
    );
  });

  test("GOOG-O28: an inverted range is refused rather than clamped", () => {
    const harness = createHarness();

    const refused = normalizeForGoogle(inverted, harness.environment.hash);

    if (refused.ok) {
      throw new Error("an inverted range was accepted");
    }
    expect(refused.failure).toEqual({ kind: "unrepresentable", constraint: "invertedRange" });
  });

  test("GOOG-O28: the fingerprint is computed over the shaped content, not the submitted content", () => {
    const harness = createHarness();

    const first = normalizeForGoogle(offGridAllDay, harness.environment.hash);
    if (!first.ok) {
      throw new Error("an all-day range was refused");
    }
    const second = normalizeForGoogle(first.value.content, harness.environment.hash);
    if (!second.ok) {
      throw new Error("a shaped all-day range was refused on the second pass");
    }

    expect(second.value.fingerprint).toEqual(first.value.fingerprint);
  });
});

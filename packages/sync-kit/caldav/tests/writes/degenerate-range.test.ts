import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("a degenerate range is refused, never widened", () => {
  test("DAV-O33: a zero-duration event is unrepresentable, not silently widened", async () => {
    const harness = createHarness();
    const zeroDuration = timedContent({
      start: "2026-03-21T09:00:00.000Z",
      end: "2026-03-21T09:00:00.000Z",
    });

    const refused = harness.provider.normalize(zeroDuration);
    const written = await harness.provider.write(
      createIntent("idem-zero", normalizedOf(zeroDuration), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(refused.ok).toBe(false);
    expect(outcomeKindOf(written)).toBe("unrepresentable");
    expect(harness.fake.requestsOf("PUT")).toEqual([]);
  }, 30_000);

  test("DAV-O33: an inverted range is refused for its own named constraint", async () => {
    const harness = createHarness();
    const inverted = timedContent({
      start: "2026-03-21T10:00:00.000Z",
      end: "2026-03-21T09:00:00.000Z",
    });

    const written = await harness.provider.write(
      createIntent("idem-inverted", normalizedOf(inverted), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    if (!written.ok || written.value.kind !== "unrepresentable") {
      throw new Error(`an inverted range answered "${outcomeKindOf(written)}"`);
    }
    expect(written.value.constraint).toBe("invertedRange");
  }, 30_000);
});

import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { normalizedOf, timedContent, updateIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

describe("two writers over one observed version cannot both win", () => {
  test("MS-O29: two writers holding the same etag produce one update and one conflict", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-contended",
        uid: "contended",
        start: "2026-03-21T09:00:00.0000000",
        end: "2026-03-21T10:00:00.0000000",
      }),
    ]);
    const observed = versionOf("ck-1-id-contended");

    const [first, second] = await Promise.all([
      harness.provider.write(
        updateIntent("id-contended", normalizedOf(timedContent({ title: "writer one" })), observed),
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
      harness.provider.write(
        updateIntent("id-contended", normalizedOf(timedContent({ title: "writer two" })), observed),
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    ]);

    expect([outcomeKindOf(first), outcomeKindOf(second)].toSorted()).toEqual([
      "conflict",
      "updated",
    ]);
  }, 30_000);
});

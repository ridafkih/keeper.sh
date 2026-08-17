import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

describe("deleting what is already gone is success, not a loop", () => {
  test("MS-O39: deleting an absent event is a successful no-op", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-once",
        uid: "once",
        start: "2026-03-21T09:00:00.0000000",
        end: "2026-03-21T10:00:00.0000000",
      }),
    ]);
    const intent = deleteIntent("id-once", versionOf("ck-1-id-once"));

    const first = await harness.provider.write(
      intent,
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );
    const second = await harness.provider.write(
      intent,
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    expect(outcomeKindOf(first)).toBe("deleted");
    expect(outcomeKindOf(second)).toBe("alreadyAbsent");
    expect(harness.fake.items()).toEqual([]);
  }, 30_000);
});

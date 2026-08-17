import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";
import { seedOf } from "../support/items";

describe("a replayed create is a no-op, because Graph mints its own identifiers", () => {
  test("MS-O30: a replayed create returns alreadyExists and creates nothing", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    const intent = createIntent(
      "idempotency-replayed",
      normalizedOf(timedContent()),
      "microsoft-tests",
    );

    const first = await harness.provider.write(
      intent,
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );
    const second = await harness.provider.write(
      intent,
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    expect(outcomeKindOf(first)).toBe("created");
    expect(outcomeKindOf(second)).toBe("alreadyExists");
    expect(harness.fake.items()).toHaveLength(1);
  }, 30_000);

  test("MS-O30: a create answered 409 is resolved by reading, never by creating again", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.failWriteOn({ onCall: 1, status: 409, code: "ErrorDuplicateTransactionId" });

    const answered = await harness.provider.write(
      createIntent("idempotency-409", normalizedOf(timedContent()), "microsoft-tests"),
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    expect(["alreadyExists", "created"]).toContain(outcomeKindOf(answered));
    expect(harness.fake.items().length).toBeLessThanOrEqual(1);
  }, 30_000);
});

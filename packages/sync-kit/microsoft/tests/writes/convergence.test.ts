import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";
import { seedOf } from "../support/items";

const fingerprintsOf = (events: readonly { fingerprint: { value: string } }[]): readonly string[] =>
  events.map((event) => event.fingerprint.value);

describe("a second sync after our own write is no work at all", () => {
  test("MS-O42: a second sync after a write is a no-op", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.rewritesBody(true);

    outcomeOf(
      await harness.provider.write(
        createIntent(
          "idempotency-convergent",
          normalizedOf(timedContent({ description: "a body Outlook will rewrite" })),
          "microsoft-tests",
        ),
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );
    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(fingerprintsOf(second.events ?? [])).toEqual(fingerprintsOf(first.events ?? []));
    expect(second.diagnostics.selfAuthored.total).toBe(first.diagnostics.selfAuthored.total);
    expect(harness.fake.writeCallCount()).toBe(1);
  }, 30_000);
});

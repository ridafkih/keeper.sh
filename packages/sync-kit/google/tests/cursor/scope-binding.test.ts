import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const oneEvent = () => [
  foreignEvent({ uid: "bound", start: "2026-03-06T09:00:00.000Z", end: "2026-03-06T10:00:00.000Z" }),
];

describe("a cursor is bound to the request shape that minted it", () => {
  test("GOOG-O5: a cursor minted under a narrow window is refused against a wider one without touching the transport", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(oneEvent()));
    const narrow = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    const callsBefore = harness.environment.transport.callCount();

    const widened = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: cursorOf(narrow) },
        operationContext(harness.environment),
      ),
    );

    expect(widened.kind).toBe("cursorLost");
    expect(harness.environment.transport.callCount()).toBe(callsBefore);
    expect(harness.fake.listCallCount()).toBe(1);
  });

  test("GOOG-O5: the same window replays as a delta rather than a refusal", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(oneEvent()));
    const scope = scopeOver(marchWindow);
    const first = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );

    const second = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.kind).toBe("delta");
  });
});

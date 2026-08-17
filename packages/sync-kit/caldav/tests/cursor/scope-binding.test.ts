import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  operationContext,
  scopeOver,
  secondCalendar,
} from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("a cursor belongs to the collection that minted it", () => {
  test("DAV-O15: a cursor minted for another collection is refused without touching the transport", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );
    const before = harness.fake.requests().length;

    const misplaced = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow, secondCalendar), resume: cursorOf(first) },
        context,
      ),
    );

    expect(misplaced.kind).toBe("cursorLost");
    expect(harness.fake.requests().length).toBe(before);
  }, 30_000);
});

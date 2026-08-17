import { describe, expect, test } from "vitest";
import { listingOf, outcomeKindOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { deleteIntent } from "../support/intents";
import { singleEventResource } from "../support/resources";

describe("a resource is addressed by its path, not by its UID", () => {
  test("DAV-O17: a resource whose filename differs from its UID is deleted at its listed path", async () => {
    const harness = createHarness({
      resources: [singleEventResource("9f2c.ics", { uid: "party@example.com", summary: "Party" })],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const listed = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );
    const [event] = listed.events ?? [];
    if (!event) {
      throw new Error("the listing described no event to delete");
    }

    const deleted = await harness.provider.write(
      deleteIntent(event.deleteHandle.value, event.version),
      context,
    );

    expect(outcomeKindOf(deleted)).toBe("deleted");
    expect(harness.fake.resourceAt(`${calendarPath}9f2c.ics`)).toBeNull();
    expect(
      harness.fake.requestsOf("DELETE").map((entry) => entry.path),
    ).toEqual([`${calendarPath}9f2c.ics`]);
  }, 30_000);
});

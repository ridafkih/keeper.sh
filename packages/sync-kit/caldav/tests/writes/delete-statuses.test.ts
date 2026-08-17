import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";
import { singleEventResource } from "../support/resources";

describe("a delete's status is broken out, not collapsed", () => {
  test("DAV-O43: a 404 delete is alreadyAbsent", async () => {
    const harness = createHarness();

    const deleted = await harness.provider.write(
      deleteIntent("/calendars/alice/personal/gone.ics", versionOf('"etag-1"')),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(outcomeKindOf(deleted)).toBe("alreadyAbsent");
  }, 30_000);

  test("DAV-O44: a 403 delete is a permanent transport failure carrying 403", async () => {
    const harness = createHarness({
      fake: { deniesDelete: true },
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });

    const denied = await harness.provider.write(
      deleteIntent("/calendars/alice/personal/one.ics", versionOf('"etag-1"')),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    if (denied.ok || denied.failure.kind !== "transport") {
      throw new Error(`a denied delete answered "${outcomeKindOf(denied)}"`);
    }
    expect(denied.failure.status).toBe(403);
    expect(denied.failure.disposition).toBe("permanent");
  }, 30_000);
});

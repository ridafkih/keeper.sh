import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("a poll that found nothing still moves the token forward", () => {
  test("DAV-O4: a 207 with no responses advances the cursor to the token the server returned", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    const quiet = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(quiet.kind).toBe("delta");
    expect(quiet.events).toEqual([]);
    expect(cursorOf(quiet).value).toBeTruthy();
  }, 30_000);

  test("DAV-O5: the previous token is never reused as the new cursor value", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.put(
      "/calendars/alice/personal/two.ics",
      singleEventResource("two.ics", { uid: "two@example.com" }).data,
    );

    const second = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(cursorOf(second).value).not.toBe(cursorOf(first).value);
  }, 30_000);
});

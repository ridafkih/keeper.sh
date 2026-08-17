import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("losing the cursor is routine, so recovery is a cheap path", () => {
  test("DAV-O67: the poll after a cursorLost snapshots and re-establishes a cursor", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("one.ics", { uid: "one@example.com" }),
        singleEventResource("two.ics", { uid: "two@example.com" }),
      ],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.configure({ rejectsSyncToken: 403 });
    const lost = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    const recovered = listingOf(
      await harness.provider.listChanges({ scope, resume: null }, context),
    );

    expect(lost.kind).toBe("cursorLost");
    expect(recovered.kind).toBe("snapshot");
    expect((recovered.events ?? []).map((event) => event.uid.value).toSorted()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(cursorOf(recovered).value).toBeTruthy();
  }, 30_000);
});

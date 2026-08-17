import { describe, expect, test } from "vitest";
import { caldavLimits } from "../../src/limits";
import { continuationOf, cursorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import type { Harness } from "../support/harness";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

const touchAll = (harness: Harness, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    const path = `${calendarPath}bulk-${index}.ics`;
    const carried = harness.fake.resourceAt(path);
    if (carried) {
      harness.fake.put(path, carried.data);
    }
  }
};

describe("a truncated walk never replays a token it has already spent", () => {
  test("DAV-O10: a removal split across truncated pages is named once, and the cursor moves past it", async () => {
    const harness = createHarness({ resources: manyResources(4) });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    const startingCursor = cursorOf(first);

    touchAll(harness, 4);
    harness.fake.remove(`${calendarPath}bulk-1.ics`);
    harness.fake.configure({ truncatesAfter: 1 });

    const walked = listingOf(
      await harness.provider.listChanges({ scope, resume: startingCursor }, context),
    );
    const named = (walked.removals ?? []).filter((removal) => removal.kind !== "outOfScope");

    expect(walked.kind).toBe("delta");
    expect(named.length).toBe(1);
    expect(cursorOf(walked).value).not.toBe(startingCursor.value);
  }, 30_000);

  test("DAV-O10: a walk still truncated at the page ceiling while carrying a removal answers cursorLost, never a continuation that would drop it", async () => {
    const count = caldavLimits.syncPageCeiling * 2;
    const harness = createHarness({ resources: manyResources(count) });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    harness.fake.remove(`${calendarPath}bulk-1.ics`);
    touchAll(harness, count);
    harness.fake.configure({ truncatesAfter: 1 });

    const walked = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(walked.kind).toBe("cursorLost");
    expect(walked.continuation).toBeUndefined();
  }, 30_000);

  test("DAV-O11: a removal-free walk stopped at the ceiling advances the continuation past the pages it read", async () => {
    const count = caldavLimits.syncPageCeiling * 2;
    const harness = createHarness({ resources: manyResources(count) });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    const startingCursor = cursorOf(first);

    touchAll(harness, count);
    harness.fake.configure({ truncatesAfter: 1 });

    const truncated = listingOf(
      await harness.provider.listChanges({ scope, resume: startingCursor }, context),
    );

    expect(truncated.kind).toBe("partial");
    expect(continuationOf(truncated).value).not.toContain(startingCursor.value);
  }, 30_000);
});

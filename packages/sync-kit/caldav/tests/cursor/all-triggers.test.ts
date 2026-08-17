import { derivableRemovals } from "@keeper.sh/sync-conformance";
import type { ChangeListing, SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { caldavLimits } from "../../src/limits";
import { withinCalDAVWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import type { Harness } from "../support/harness";
import {
  createHarness,
  decadeWindow,
  operationContext,
  scopeOver,
  secondCalendar,
} from "../support/harness";
import { manyResources, singleEventResource } from "../support/resources";

const collection = [
  singleEventResource("one.ics", { uid: "one@example.com" }),
  singleEventResource("two.ics", { uid: "two@example.com" }),
];

const firstCursor = async (harness: Harness): Promise<SyncCursor> => {
  const listing = listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    ),
  );
  return cursorOf(listing);
};

const rejectedToken = async (): Promise<ChangeListing> => {
  const harness = createHarness({ resources: collection });
  const cursor = await firstCursor(harness);
  harness.fake.configure({ rejectsSyncToken: 403 });
  return listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: cursor },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    ),
  );
};

const truncatedWalkCarryingARemoval = async (): Promise<ChangeListing> => {
  const count = caldavLimits.syncPageCeiling * 2;
  const harness = createHarness({ resources: manyResources(count) });
  const cursor = await firstCursor(harness);
  harness.fake.remove(`${calendarPath}bulk-1.ics`);
  for (let index = 0; index < count; index += 1) {
    const path = `${calendarPath}bulk-${index}.ics`;
    harness.fake.put(path, harness.fake.resourceAt(path)?.data ?? "");
  }
  harness.fake.configure({ truncatesAfter: 1 });
  return listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: cursor },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    ),
  );
};

const foreignScope = async (): Promise<ChangeListing> => {
  const harness = createHarness({ resources: collection });
  const cursor = await firstCursor(harness);
  return listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow, secondCalendar), resume: cursor },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    ),
  );
};

const olderVersion = async (): Promise<ChangeListing> => {
  const harness = createHarness({ resources: collection });
  const scope = scopeOver(decadeWindow);
  return listingOf(
    await harness.provider.listChanges(
      { scope, resume: { kind: "syncCursor", value: "v0:whatever", scope } },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    ),
  );
};

describe("cursorLost is one arm, reached four ways", () => {
  test("DAV-O66: the four cursorLost triggers take one code path and none emits a removal", async () => {
    const listings = [
      await rejectedToken(),
      await truncatedWalkCarryingARemoval(),
      await foreignScope(),
      await olderVersion(),
    ];

    expect(listings.map((listing) => listing.kind)).toEqual([
      "cursorLost",
      "cursorLost",
      "cursorLost",
      "cursorLost",
    ]);
    for (const listing of listings) {
      expect(
        derivableRemovals({
          listing,
          known: knownMirrorOf([]),
          withinWindow: withinCalDAVWindow,
        }),
      ).toEqual([]);
      expect(listing.events).toBeUndefined();
      expect(listing.cursor).toBeUndefined();
    }
  }, 30_000);
});

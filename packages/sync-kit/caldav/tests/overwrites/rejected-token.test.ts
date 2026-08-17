import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

const listingAfterRejection = async (status: number): Promise<ReturnType<typeof listingOf>> => {
  const harness = createHarness({ resources: manyResources(3) });
  const scope = scopeOver(decadeWindow);
  const context = operationContext(harness.environment, { deadlineMs: 2000 });
  const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
  harness.fake.configure({ rejectsSyncToken: status });
  return listingOf(
    await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
  );
};

describe("a rejected sync-token is cursorLost, never quiet and never empty", () => {
  test("DAV-O6: a 403 valid-sync-token yields cursorLost and zero removals", async () => {
    const listing = await listingAfterRejection(403);

    expect(listing.kind).toBe("cursorLost");
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf([]),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);

  test("DAV-O7: a 409 valid-sync-token takes the identical arm", async () => {
    const forbidden = await listingAfterRejection(403);
    const conflicted = await listingAfterRejection(409);

    expect(conflicted.kind).toBe(forbidden.kind);
    expect(conflicted.kind).toBe("cursorLost");
    expect(conflicted.events).toBeUndefined();
    expect(conflicted.removals).toBeUndefined();
  }, 30_000);
});

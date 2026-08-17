import { derivableRemovals } from "@keeper.sh/sync-conformance";
import type { SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("a cursor from an older adapter is not readable by this one", () => {
  test("DAV-O16: a cursor from an older adapter version is cursorLost and emits no removals", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const fromAnOlderAdapter: SyncCursor = {
      kind: "syncCursor",
      value: "v0:http://dav.example.com/ns/sync/1",
      scope,
    };

    const listing = listingOf(
      await harness.provider.listChanges({ scope, resume: fromAnOlderAdapter }, context),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf([]),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);
});

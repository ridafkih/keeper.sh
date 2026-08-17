import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

describe("a capped multiget is a short read, never an absence", () => {
  test("DAV-O1: a multiget answering 3 of 5 hrefs yields zero derivable removals", async () => {
    const harness = createHarness({
      fake: { capsMultigetAt: 3, announcesSyncCollection: false },
      resources: manyResources(5),
    });
    const scope = scopeOver(decadeWindow);

    const first = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    const known = knownMirrorOf(first.events ?? []);
    expect(first.kind).toBe("partial");
    expect(derivableRemovals({ listing: first, known, withinWindow: withinCalDAVWindow })).toEqual(
      [],
    );
  }, 30_000);

  test("DAV-O1: the five events the server holds are never described as three", async () => {
    const harness = createHarness({
      fake: { capsMultigetAt: 3, announcesSyncCollection: false },
      resources: manyResources(5),
    });

    const listed = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listed.coverage).toBeUndefined();
    expect(listed.cursor).toBeUndefined();
  }, 30_000);
});

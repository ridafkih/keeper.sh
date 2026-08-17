import { canonicalise } from "@keeper.sh/sync-conformance";
import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { emptyBodyResource, manyResources } from "../support/resources";

const comparable = (listing: ChangeListing): string =>
  canonicalise({
    kind: listing.kind,
    events: (listing.events ?? []).map((event) => ({
      id: event.id.value,
      uid: event.uid.value,
      fingerprint: event.fingerprint.value,
    })),
    withheld: (listing.withheld ?? []).map((entry) => ({
      uid: entry.uid?.value ?? null,
      reason: entry.reason,
    })),
    removals: (listing.removals ?? []).map((removal) => removal.id.value),
  });

describe("polling twice is the same answer twice", () => {
  test("DAV-O62: two polls of an unchanged collection produce identical listings", async () => {
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: manyResources(4),
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    const second = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    expect(comparable(second)).toBe(comparable(first));
  }, 30_000);

  test("DAV-O63: reordering the server's responses does not change the listing", async () => {
    const forward = createHarness({
      fake: { announcesSyncCollection: false },
      resources: manyResources(4),
    });
    const reversed = createHarness({
      fake: { announcesSyncCollection: false },
      resources: [...manyResources(4)].toReversed(),
    });
    const scope = scopeOver(decadeWindow);

    const first = listingOf(
      await forward.provider.listChanges(
        { scope, resume: null },
        operationContext(forward.environment, { deadlineMs: 2000 }),
      ),
    );
    const second = listingOf(
      await reversed.provider.listChanges(
        { scope, resume: null },
        operationContext(reversed.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(comparable(second)).toBe(comparable(first));
  }, 30_000);

  test("DAV-O22: a second poll over the same empty body produces the same listing", async () => {
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: [emptyBodyResource("blank.ics")],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    const second = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    expect(comparable(second)).toBe(comparable(first));
    expect((first.withheld ?? []).length).toBe(1);
  }, 30_000);
});

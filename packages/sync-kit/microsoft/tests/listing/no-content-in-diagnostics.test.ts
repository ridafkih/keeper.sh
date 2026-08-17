import { assertNoContentInDiagnostics } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const distinctiveTitle = "Board meeting with Acme about the acquisition";
const distinctiveDescription = "the offer is 41 million";
const distinctiveLocation = "12 Rue de la Paix";

describe("customer content never leaves the process in diagnostics", () => {
  test("MS-O41: no event title, description or location reaches diagnostics", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-secret",
        uid: "secret",
        start: "2026-03-14T09:00:00.0000000",
        end: "2026-03-14T10:00:00.0000000",
        subject: distinctiveTitle,
        description: distinctiveDescription,
        location: distinctiveLocation,
        originalStartTimeZone: "Nonsense Standard Time",
        timeZone: "Nonsense Standard Time",
      }),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.diagnostics.withheld.total).toBe(1);
    assertNoContentInDiagnostics(listing, [
      distinctiveTitle,
      distinctiveDescription,
      distinctiveLocation,
    ]);
  });
});

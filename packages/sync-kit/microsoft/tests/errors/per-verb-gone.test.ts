import { describe, expect, test } from "vitest";
import { listingOf, outcomeKindOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";
import { manyForeignEvents, seedOf } from "../support/items";

describe("one status does not mean one thing everywhere", () => {
  test("MS-O38: a 410 on listChanges is cursorLost and a 410 on delete is alreadyAbsent", async () => {
    const listing = createHarness();
    listing.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    listing.fake.failListOn({ onCall: 1, status: 410, code: "resyncRequired" });

    const listed = listingOf(
      await listing.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(listing.environment),
      ),
    );

    const removal = createHarness();
    removal.fake.seedFromProvider(seedOf([]));
    removal.fake.failWriteOn({ onCall: 1, status: 410, code: "ErrorItemNotFound" });

    const deleted = await removal.provider.write(
      deleteIntent("id-vanished", versionOf("ck-1-id-vanished")),
      operationContext(removal.environment),
    );

    expect(listed.kind).toBe("cursorLost");
    expect(outcomeKindOf(deleted)).toBe("alreadyAbsent");
  }, 30_000);
});

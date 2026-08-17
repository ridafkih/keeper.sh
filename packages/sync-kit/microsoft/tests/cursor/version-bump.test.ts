import { conformanceHash } from "@keeper.sh/sync-conformance";
import type { SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { cursorVersion, encodeCursorValue } from "../../src/cursor/cursor";
import { requestShapeFingerprint } from "../../src/cursor/fingerprint";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

const cursorFromAnOlderAdapter = (): SyncCursor => {
  const scope = scopeOver(marchWindow);
  return {
    kind: "syncCursor",
    value: encodeCursorValue({
      version: cursorVersion - 1,
      mode: "delta",
      scopeFingerprint: requestShapeFingerprint(scope, "delta", conformanceHash),
      providerLink: "https://graph.microsoft.com/delta?$deltatoken=old",
    }),
    scope,
  };
};

describe("a cursor minted by an older adapter is refused, not trusted", () => {
  test("MS-O6: a cursor from an older adapter version is cursorLost and emits no removals", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorFromAnOlderAdapter() },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.removals).toBeUndefined();
  });

  test("MS-O6: the version refusal costs no request", async () => {
    const harness = createHarness();

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: cursorFromAnOlderAdapter() },
      operationContext(harness.environment),
    );

    expect(harness.fake.listCallCount()).toBe(0);
  });
});

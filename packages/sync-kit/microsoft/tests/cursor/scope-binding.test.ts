import { conformanceHash } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { mintCursor, parseCursor } from "../../src/cursor/cursor";
import { listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";

describe("a delta link is only ever replayed against the window that minted it", () => {
  test("MS-O5: a cursor minted under a narrow window is refused against a wider one without touching the transport", async () => {
    const harness = createHarness();
    const narrow = mintCursor(scopeOver(marchWindow), "https://graph.microsoft.com/delta", {
      hash: conformanceHash,
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: narrow },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(harness.environment.transport.callCount()).toBe(0);
    expect(harness.fake.listCallCount()).toBe(0);
  });

  test("MS-O5: the same cursor read back against its own scope is usable", () => {
    const scope = scopeOver(marchWindow);
    const minted = mintCursor(scope, "https://graph.microsoft.com/delta", {
      hash: conformanceHash,
    });

    expect(parseCursor(minted, scope, { hash: conformanceHash }).kind).toBe("usable");
    expect(parseCursor(minted, scopeOver(decadeWindow), { hash: conformanceHash }).kind).toBe(
      "unreadable",
    );
  });
});

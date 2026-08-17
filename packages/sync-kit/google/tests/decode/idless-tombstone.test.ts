import { describe, expect, test } from "vitest";
import { decodeEvent } from "../../src/decode/decode-event";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { cancelledWithoutIdentity, timedItem } from "../support/items";
import { countingTimeDecoder } from "../support/time-decoder";

describe("an unattributable cancellation is counted, never guessed at", () => {
  test("GOOG-O13: an id-less cancellation is counted, not removed", async () => {
    const harness = createHarness();
    harness.fake.putItems([
      timedItem({
        id: "present",
        start: "2026-03-12T09:00:00.000Z",
        end: "2026-03-12T10:00:00.000Z",
      }),
      cancelledWithoutIdentity(),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.removals).toEqual([]);
    expect(listing.diagnostics.withheld.total).toBe(1);
  });

  test("GOOG-O13: the decoder names the missing identity as the reason", () => {
    const decoder = countingTimeDecoder();

    const decoded = decodeEvent(cancelledWithoutIdentity(), decoder.decode);

    expect(decoded).toEqual({ kind: "undecodable", id: null, uid: null, reason: "missingIdentity" });
  });
});

import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("line endings are canonicalised once, for the hash and for the wire", () => {
  test("DAV-O65: an event whose description arrives CRLF hashes identically after a write and a read-back", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const crlf = timedContent({ description: "first line\r\nsecond line" });
    const lf = timedContent({ description: "first line\nsecond line" });

    const normalisedCrlf = harness.provider.normalize(crlf);
    const normalisedLf = harness.provider.normalize(lf);
    const created = await harness.provider.write(
      createIntent("idem-crlf", normalizedOf(crlf), "caldav-tests"),
      context,
    );
    const listing = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );

    if (!normalisedCrlf.ok || !normalisedLf.ok) {
      throw new Error("a representable description refused normalisation");
    }
    expect(normalisedCrlf.value.fingerprint).toEqual(normalisedLf.value.fingerprint);
    expect(outcomeOf(created).kind).toBe("created");
    const [event] = listing.events ?? [];
    expect(event?.fingerprint).toEqual(normalisedCrlf.value.fingerprint);
  }, 30_000);
});

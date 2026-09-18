import { describe, expect, test } from "vitest";
import { listChanges, listingKindOf, okValue } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { foreignEvent, scopeOver, seedOf, spanning } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const usable = foreignEvent({
  uid: "usable",
  title: "Usable",
  start: "2026-03-02T09:00:00.000Z",
  end: "2026-03-02T10:00:00.000Z",
});
const unusable = foreignEvent({
  uid: "unusable",
  title: "Unusable",
  start: "2026-03-03T10:00:00.000Z",
  end: "2026-03-03T09:00:00.000Z",
});
const doomed = foreignEvent({
  uid: "doomed",
  title: "Doomed",
  start: "2026-03-04T09:00:00.000Z",
  end: "2026-03-04T10:00:00.000Z",
});

describe("one bad event does not stall the feed", () => {
  test("CONF-O6: a listing carrying one unusable item still returns the other items", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([usable, unusable], []));

    const result = await listChanges(harness.provider, harness.environment, scope);

    expect(listingKindOf(result)).toBe("snapshot");
    expect((okValue(result).events ?? []).map((event) => event.uid.value)).toContain("usable");
    await harness.dispose();
  });

  test("CONF-O6: a real deletion in the same payload as an unusable item still applies", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([usable, unusable, doomed], []));
    await listChanges(harness.provider, harness.environment, scope);

    await harness.provider.seed(seedOf([usable, unusable], []));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const removed = (listing.removals ?? []).flatMap((removal) => {
      if (removal.kind === "outOfScope") {
        return [];
      }
      return [removal.uid.value];
    });

    expect(removed).toContain("doomed");
    await harness.dispose();
  });

  test("CONF-O6: a second identical poll of a malformed feed is byte-identical", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([usable, unusable], []));

    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const second = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(second.withheld).toEqual(first.withheld);
    expect(second.diagnostics).toEqual(first.diagnostics);
    await harness.dispose();
  });

  test("CONF-O6: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O6")).resolves.toBeUndefined();
  });
});

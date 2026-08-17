import { describe, expect, test } from "vitest";
import { microsoftLimits } from "../../src/limits";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

const listOnce = async (
  harness: ReturnType<typeof createHarness>,
): Promise<string> => {
  const listing = listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    ),
  );
  return listing.kind;
};

describe("a loop-breaker can never authorise a deletion", () => {
  test("MS-O36: a walk stopped by either bound never returns a delta", async () => {
    const ceilingBound = createHarness();
    ceilingBound.fake.seedFromProvider(seedOf(manyForeignEvents(40)));
    ceilingBound.fake.pageEvery(1);
    ceilingBound.fake.cyclesNextLink();

    const repeatBound = createHarness();
    repeatBound.fake.seedFromProvider(seedOf(manyForeignEvents(40)));
    repeatBound.fake.pageEvery(1);
    repeatBound.fake.repeatsLinkAfter(2);

    const stoppedByCeiling = await listOnce(ceilingBound);
    const stoppedByRepeat = await listOnce(repeatBound);

    expect(stoppedByCeiling).toBe("partial");
    expect(stoppedByRepeat).toBe("partial");
    expect(microsoftLimits.maxPages).toBeGreaterThan(2);
  }, 30_000);
});

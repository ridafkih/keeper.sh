import { assertNoRemovalDerivable } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { paginateGraph } from "../../src/listing/paginate";
import { microsoftLimits } from "../../src/limits";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

const cyclingPage = (link: string | null) =>
  Promise.resolve({
    kind: "page",
    page: {
      items: [{ id: "one-page-of-work" }],
      nextLink: `https://graph.microsoft.com/v1.0/cycle?$skiptoken=${link ?? "first"}`,
      deltaLink: null,
    },
  } as const);

describe("a nextLink that never changes cannot loop forever", () => {
  test("MS-L10: a nextLink that never changes ends the walk at the ceiling", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(60)));
    harness.fake.pageEvery(1);
    harness.fake.cyclesNextLink();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(harness.fake.listCallCount()).toBe(microsoftLimits.maxPages);
    expect(listing.kind).toBe("partial");
    assertNoRemovalDerivable(listing);
  }, 30_000);

  test("MS-L10: the ceiling that stopped the walk is the configured one", async () => {
    const harness = createHarness();
    let pagesRequested = 0;

    const three = await paginateGraph({
      context: operationContext(harness.environment, { deadlineMs: 5000 }),
      clock: harness.environment.clock,
      maxPages: 3,
      fetchPage: (link) => {
        pagesRequested += 1;
        return cyclingPage(link);
      },
    });
    const walkedUnderThree = pagesRequested;
    pagesRequested = 0;
    const five = await paginateGraph({
      context: operationContext(harness.environment, { deadlineMs: 5000 }),
      clock: harness.environment.clock,
      maxPages: 5,
      fetchPage: (link) => {
        pagesRequested += 1;
        return cyclingPage(link);
      },
    });

    expect(walkedUnderThree).toBe(3);
    expect(pagesRequested).toBe(5);
    expect(three.kind).toBe("truncated");
    expect(five.kind).toBe("truncated");
  }, 30_000);
});

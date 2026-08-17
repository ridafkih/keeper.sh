import { assertNoRemovalDerivable } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { googleListingLimits } from "../../src/limits";
import { paginateEvents } from "../../src/listing/paginate";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { hundredForeignEvents, seedOf } from "../support/items";

describe("pagination stops at a ceiling a hostile server cannot lift", () => {
  test("GOOG-L2: a server that always returns a page token stops at the ceiling with a continuation", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(hundredForeignEvents()));
    harness.fake.neverStopPaging();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.kind).toBe("partial");
    expect(harness.fake.listCallCount()).toBe(googleListingLimits.maxPages);
    assertNoRemovalDerivable(listing);
  }, 30_000);

  test("GOOG-L2: the ceiling reports how many pages it actually read", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(hundredForeignEvents()));
    harness.fake.neverStopPaging();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.diagnostics.pagesFetched).toBe(googleListingLimits.maxPages);
    expect(listing.continuation?.scope.calendar.calendar.value).toBe("primary");
  }, 30_000);

  test("GOOG-L2: a loop that runs out of budget mid-walk hands back the pages it read, not nothing", async () => {
    const harness = createHarness();
    const started = Date.parse(harness.environment.clock.now().value);
    let elapsed = 0;
    const walk = await paginateEvents({
      context: operationContext(harness.environment, { deadlineMs: 100 }),
      clock: {
        now: () => ({ kind: "instant", value: new Date(started + elapsed).toISOString() }),
        sleep: harness.environment.clock.sleep,
      },
      maxPages: googleListingLimits.maxPages,
      fetchPage: () => {
        elapsed += 200;
        return Promise.resolve({
          kind: "page",
          page: { items: [{ id: "one-page-of-work" }], nextPageToken: "there-is-more" },
        });
      },
    });

    expect(walk.kind).toBe("truncated");
    if (walk.kind !== "truncated") {
      throw new Error("a spent budget threw away the pages it had already read");
    }
    expect(walk.items).toHaveLength(1);
    expect(walk.pageToken).toBe("there-is-more");
  }, 30_000);

  test("GOOG-L2: a budget spent before the first page is notAttempted, never a truncation of nothing", async () => {
    const harness = createHarness();
    const past = Date.parse(harness.environment.clock.now().value) - 10_000;

    const walk = await paginateEvents({
      context: operationContext(harness.environment, { deadlineMs: -1000 }),
      clock: {
        now: () => ({ kind: "instant", value: new Date(past + 20_000).toISOString() }),
        sleep: harness.environment.clock.sleep,
      },
      maxPages: googleListingLimits.maxPages,
      fetchPage: () => Promise.reject(new Error("a spent budget still reached the transport")),
    });

    expect(walk).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
  }, 30_000);
});

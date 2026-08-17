import type { ListingScope } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "either", start: "2026-03-24T09:00:00.000Z", end: "2026-03-24T10:00:00.000Z" }),
];

const listingOver = (harness: ReturnType<typeof createHarness>, scope: ListingScope) =>
  harness.provider.listChanges({ scope, resume: null }, operationContext(harness.environment));

describe("two callers taking two scopes in opposite orders cannot deadlock", () => {
  test("GOOG-L6: two callers in opposite key orders both settle", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const narrow = scopeOver(marchWindow);
    const wide = scopeOver(decadeWindow);

    const answers = await Promise.all([
      listingOver(harness, narrow),
      listingOver(harness, wide),
      listingOver(harness, wide),
      listingOver(harness, narrow),
    ]);

    expect(answers.map((answer) => answer.ok)).toEqual([true, true, true, true]);
  }, 30_000);

  test("GOOG-L6: no answer is crossed with the scope it was not asked about", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const narrow = scopeOver(marchWindow);
    const wide = scopeOver(decadeWindow);

    const [first, second] = await Promise.all([
      listingOver(harness, narrow),
      listingOver(harness, wide),
    ]);

    if (!first || !second) {
      throw new Error("a concurrent listing produced no answer at all");
    }
    expect(listingOf(first).scope.window.end.value).toBe(marchWindow.end.value);
    expect(listingOf(second).scope.window.end.value).toBe(decadeWindow.end.value);
  }, 30_000);

  test("GOOG-L6: two callers over one key share a single request, so no second key is ever held", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const narrow = scopeOver(marchWindow);

    const [first, second] = await Promise.all([
      listingOver(harness, narrow),
      listingOver(harness, narrow),
    ]);

    expect([first?.ok, second?.ok]).toEqual([true, true]);
    expect(harness.fake.listCallCount()).toBe(1);
  }, 30_000);
});

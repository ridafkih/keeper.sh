import { describe, expect, test } from "vitest";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const olderCopy: GraphEvent = timedItem({
  id: "id-collides",
  uid: "collides",
  start: "2026-03-14T09:00:00.0000000",
  end: "2026-03-14T10:00:00.0000000",
  subject: "the older copy",
  lastModified: "2026-03-11T09:00:00.000Z",
  changeKey: "ck-1-id-collides",
});

const newerCopy: GraphEvent = timedItem({
  id: "id-collides",
  uid: "collides",
  start: "2026-03-14T11:00:00.0000000",
  end: "2026-03-14T12:00:00.0000000",
  subject: "the newer copy",
  lastModified: "2026-03-11T10:00:00.000Z",
  changeKey: "ck-2-id-collides",
});

const listWith = async (order: readonly GraphEvent[]): Promise<readonly string[]> => {
  const harness = createHarness();
  harness.fake.seedFromProvider(seedOf([]));
  harness.fake.putItems(order);
  harness.fake.pageEvery(1);

  const listing = listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    ),
  );
  return (listing.events ?? []).map((event) => event.content.title);
};

describe("the same id twice collapses deterministically", () => {
  test("MS-O20: the same id twice collapses to the newest revision, and both page orders give the same answer", async () => {
    const forwards = await listWith([olderCopy, newerCopy]);
    const backwards = await listWith([newerCopy, olderCopy]);

    expect(forwards).toEqual(["the newer copy"]);
    expect(backwards).toEqual(forwards);
  }, 30_000);
});

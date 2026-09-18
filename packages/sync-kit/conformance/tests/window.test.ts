import { describe, expect, test } from "vitest";
import { derivableRemovals } from "../src/assertions/no-removal";
import { listChanges, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import {
  createIntent,
  foreignEvent,
  isInsideWindow,
  occurrence,
  scopeOver,
  spanning,
  timeOf,
  timedAt,
  knownFrom,
  seedOf,
} from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const onTheLowerEdge = foreignEvent({
  uid: "lower-edge",
  title: "Lower edge",
  start: "2026-03-01T00:00:00.000Z",
  end: "2026-03-01T01:00:00.000Z",
});
const onTheUpperEdge = foreignEvent({
  uid: "upper-edge",
  title: "Upper edge",
  start: "2026-03-31T23:00:00.000Z",
  end: "2026-04-01T00:00:00.000Z",
});
const outsideTheWindow = foreignEvent({
  uid: "outside",
  title: "Outside",
  start: "2026-05-02T09:00:00.000Z",
  end: "2026-05-02T10:00:00.000Z",
});
const zeroDuration = foreignEvent({
  uid: "degenerate",
  title: "Zero duration",
  start: "2026-03-10T09:00:00.000Z",
  end: "2026-03-10T09:00:00.000Z",
});

describe("one window predicate, agreeing at every boundary", () => {
  test("CONF-O27: the lower edge is admitted by the same predicate at listing and removal time", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([onTheLowerEdge], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const removable = derivableRemovals({
      listing,
      known: knownFrom([onTheLowerEdge]),
      withinWindow: isInsideWindow,
    });

    expect((listing.events ?? []).map((event) => event.uid.value)).toEqual(["lower-edge"]);
    expect(removable).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O27: the upper edge gets the same verdict from the predicate on both sides", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([onTheUpperEdge], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const listed = (listing.events ?? []).some((event) => event.uid.value === "upper-edge");
    const admitted = isInsideWindow(march, timeOf(onTheUpperEdge));

    expect(listed).toBe(admitted);
    await harness.dispose();
  });

  test("CONF-O27: an inverted window admits nothing and removes nothing", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([onTheLowerEdge], []));
    const inverted = scopeOver(
      spanning("2026-04-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
    );

    const listing = okValue(await listChanges(harness.provider, harness.environment, inverted));

    expect(listing.events ?? []).toEqual([]);
    expect(
      derivableRemovals({
        listing,
        known: knownFrom([onTheLowerEdge]),
        withinWindow: isInsideWindow,
      }),
    ).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O26: an event reported outside the requested window is returned and never removed", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([outsideTheWindow], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(
      derivableRemovals({
        listing,
        known: knownFrom([outsideTheWindow]),
        withinWindow: isInsideWindow,
      }),
    ).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O26: two polls do not oscillate an out-of-window event between add and retire", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([outsideTheWindow], []));

    await listChanges(harness.provider, harness.environment, scope);
    const afterFirst = await harness.provider.inspect();
    await listChanges(harness.provider, harness.environment, scope);
    const afterSecond = await harness.provider.inspect();

    expect(afterSecond.writeLog).toEqual(afterFirst.writeLog);
    await harness.dispose();
  });

  test("CONF-O28: a zero-duration event is preserved at the source", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([zeroDuration], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const found = (listing.events ?? []).filter((event) => event.uid.value === "degenerate");

    expect(found).toHaveLength(1);
    expect(harness.supports.representableRange.zeroDuration).toBe("accept");
    await harness.dispose();
  });

  test("CONF-O28: a widened mirror of a degenerate range does not read as changed", async () => {
    const harness = await referenceHarness();
    const degenerate = occurrence(
      "Zero duration",
      timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T09:00:00.000Z"),
    );
    await write(harness.provider, harness.environment, createIntent("degenerate", degenerate));

    await listChanges(harness.provider, harness.environment, scope);
    const afterFirst = await harness.provider.inspect();
    await listChanges(harness.provider, harness.environment, scope);
    const afterSecond = await harness.provider.inspect();

    expect(afterSecond.writeLog).toEqual(afterFirst.writeLog);
    await harness.dispose();
  });

  test("CONF-O26: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O26")).resolves.toBeUndefined();
  });

  test("CONF-O27: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O27")).resolves.toBeUndefined();
  });

  test("CONF-O28: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O28")).resolves.toBeUndefined();
  });
});

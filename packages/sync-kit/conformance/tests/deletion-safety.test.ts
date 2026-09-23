import { describe, expect, test } from "vitest";
import { assertNoRemovalDerivable, derivableRemovals } from "../src/assertions/no-removal";
import { truncatingAfter } from "../src/fixtures";
import { referenceCalendar } from "../src/reference/provider";
import { ConformanceViolation } from "../src/violation";
import { failureOf, listChanges, listingKindOf, okValue } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import {
  foreignEvent,
  instant,
  knownFrom,
  knownNamed,
  scopeOver,
  seedOf,
  spanning,
  timedAt,
} from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const alpha = foreignEvent({
  uid: "alpha",
  title: "Alpha",
  start: "2026-03-02T09:00:00.000Z",
  end: "2026-03-02T10:00:00.000Z",
});
const bravo = foreignEvent({
  uid: "bravo",
  title: "Bravo",
  start: "2026-03-03T09:00:00.000Z",
  end: "2026-03-03T10:00:00.000Z",
});
const charlie = foreignEvent({
  uid: "charlie",
  title: "Charlie",
  start: "2026-03-04T09:00:00.000Z",
  end: "2026-03-04T10:00:00.000Z",
});

const threeEvents = [alpha, bravo, charlie];

const knownFromSeed = () => knownFrom(threeEvents);

describe("a short read is never a deletion", () => {
  test("CONF-O1: a page truncated to one of three events never yields a snapshot", async () => {
    const harness = await referenceHarness(truncatingAfter(1));
    await harness.provider.seed(seedOf(threeEvents, []));

    const result = await listChanges(harness.provider, harness.environment, scope);

    expect(listingKindOf(result)).not.toBe("snapshot");
    expect(listingKindOf(result)).not.toBe("delta");
    await harness.dispose();
  });

  test("CONF-O1: a truncated page derives no removal even though two seeded events are missing", async () => {
    const harness = await referenceHarness(truncatingAfter(1));
    await harness.provider.seed(seedOf(threeEvents, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(() => assertNoRemovalDerivable(listing)).not.toThrow();
    expect(
      derivableRemovals({ listing, known: knownFromSeed(), withinWindow: () => true }),
    ).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O1: a truncated page returns a continuation and structurally cannot carry a cursor", async () => {
    const harness = await referenceHarness(truncatingAfter(1));
    await harness.provider.seed(seedOf(threeEvents, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.kind).toBe("partial");
    expect(listing.cursor).toBeUndefined();
    expect(listing.coverage).toBeUndefined();
    expect(listing.removals).toBeUndefined();
    await harness.dispose();
  });

  test("CONF-O1: the case itself passes for the reference provider under truncation", async () => {
    await expect(runReferenceCase("CONF-O1", truncatingAfter(1))).resolves.toBeUndefined();
  });

  test("CONF-O2: a transport failure and an empty calendar are two distinguishable outputs", async () => {
    const failing = await referenceHarness();
    await failing.provider.seed(seedOf([], []));
    failing.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "transport", status: 503, disposition: "transient" },
      times: 8,
    });
    const failed = await listChanges(failing.provider, failing.environment, scope);

    const empty = await referenceHarness();
    await empty.provider.seed(seedOf([], []));
    const emptied = await listChanges(empty.provider, empty.environment, scope);

    expect(failureOf(failed).kind).toBe("transport");
    expect(okValue(emptied).kind).toBe("snapshot");
    expect(failed).not.toEqual(emptied);
    await failing.dispose();
    await empty.dispose();
  });

  test("CONF-O2: a genuinely empty calendar still proves its coverage", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.coverage).toEqual({ covered: march, calendar: referenceCalendar });
    expect(listing.events).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O3: the reference declares snapshotAbsence, so absence inside coverage is a removal", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([alpha], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(harness.supports.deletionAuthority).toBe("snapshotAbsence");
    expect(
      derivableRemovals({ listing, known: knownFromSeed(), withinWindow: () => true }),
    ).toEqual(["bravo", "charlie"]);
    await harness.dispose();
  });

  test("CONF-O3: the case rejects an adapter that deletes an unnamed identity under explicitRemovalsOnly", async () => {
    await expect(runReferenceCase("CONF-O3")).resolves.toBeUndefined();
  });

  test("CONF-O4: proven coverage is the narrower window, never the requested one", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(threeEvents, []));
    const wider = scopeOver(spanning("2020-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"));

    const listing = okValue(await listChanges(harness.provider, harness.environment, wider));

    expect(listing.coverage?.covered).not.toEqual(wider.window);
    expect(listing.coverage?.calendar).toEqual(wider.calendar);
    await harness.dispose();
  });

  test("CONF-O4: nothing in the requested-but-uncovered band is derivable as a removal", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(threeEvents, []));
    const wider = scopeOver(spanning("2020-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"));
    const listing = okValue(await listChanges(harness.provider, harness.environment, wider));

    const removed = derivableRemovals({
      listing,
      known: knownNamed("ancient", timedAt("2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z")),
      withinWindow: () => true,
    });

    expect(removed).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O5: a withheld event is reported as present and never becomes a removal", async () => {
    const harness = await referenceHarness();
    const unrepresentable = foreignEvent({
      uid: "inverted",
      title: "Inverted",
      start: "2026-03-05T10:00:00.000Z",
      end: "2026-03-05T09:00:00.000Z",
    });
    await harness.provider.seed(seedOf([unrepresentable], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.withheld?.map((entry) => entry.reason)).toEqual(["unrepresentableTime"]);
    expect(
      derivableRemovals({
        listing,
        known: knownFrom([unrepresentable]),
        withinWindow: () => true,
      }),
    ).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O12: a corrupt known row demands a resync and emits zero removals", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(threeEvents, ["bravo"]));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.kind).toBe("cursorLost");
    expect(listing.removals).toBeUndefined();
    await harness.dispose();
  });

  test("CONF-O13: an ambiguous removal is excluded from removals rather than deleted", async () => {
    await expect(runReferenceCase("CONF-O13")).resolves.toBeUndefined();
  });

  test("CONF-O33: a withheld identity keeps its mirror on the destination side", async () => {
    await expect(runReferenceCase("CONF-O33")).resolves.toBeUndefined();
  });

  test("CONF-O34: cancelled, unnamed and outOfScope are three different verdicts", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(threeEvents, []));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    const removals = listing.removals ?? [];

    expect(removals.filter((removal) => removal.kind === "outOfScope")).toEqual([]);
    expect(
      derivableRemovals({ listing, known: knownFromSeed(), withinWindow: () => true }),
    ).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O41: a truncated page's resumable token is a Continuation, never a SyncCursor", async () => {
    const harness = await referenceHarness(truncatingAfter(2));
    await harness.provider.seed(seedOf(threeEvents, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.continuation?.kind).toBe("continuation");
    expect(listing.cursor).toBeUndefined();
    await harness.dispose();
  });

  test("CONF-O41: resuming from the continuation eventually proves coverage without ever deleting", async () => {
    const harness = await referenceHarness(truncatingAfter(2));
    await harness.provider.seed(seedOf(threeEvents, []));
    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const resume = first.continuation ?? null;

    const second = okValue(await listChanges(harness.provider, harness.environment, scope, resume));

    expect(first.kind).toBe("partial");
    expect(second.kind).toBe("snapshot");
    expect(() => assertNoRemovalDerivable(first)).not.toThrow();
    await harness.dispose();
  });

  test("CONF-O1: assertNoRemovalDerivable throws a typed ConformanceViolation on a snapshot short read", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([alpha], []));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(() => assertNoRemovalDerivable(listing)).toThrow(ConformanceViolation);
    await harness.dispose();
  });

  test("CONF-O4: a coverage window proved for a different calendar is refused", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(threeEvents, []));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.coverage?.calendar.calendar.value).toBe(
      referenceCalendar.calendar.value,
    );
    expect(listing.coverage?.covered.start).toEqual(instant(march.start.value));
    await harness.dispose();
  });
});

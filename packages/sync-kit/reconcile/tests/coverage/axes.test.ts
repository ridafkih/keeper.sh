import { describe, expect, test } from "vitest";
import { at, firstOf } from "../support/at";
import { defaultWindowMembership, insideProvenCoverage, planReconciliation } from "../../src/index";
import {
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceCalendar,
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const historicSpan = { start: "2026-02-01T09:00:00.000Z", end: "2026-02-01T10:00:00.000Z" };
const futureSpan = { start: "2026-09-01T09:00:00.000Z", end: "2026-09-01T10:00:00.000Z" };

const historicIdentity = slotIdentity("evt-historic", historicSpan.start, historicSpan.end);
const futureIdentity = slotIdentity("evt-future", futureSpan.start, futureSpan.end);

const futureAxisOnly = {
  kind: "proven" as const,
  calendar: sourceCalendar,
  historic: { start: instant("2026-06-01T00:00:00.000Z"), end: instant("2026-06-01T00:00:00.000Z") },
  future: { start: instant("2026-06-01T00:00:00.000Z"), end: instant("2026-12-31T00:00:00.000Z") },
};

const bothAbsent = () => ({
  observed: sourceOnly(snapshotListing({ events: [] })),
  known: knownState([
    knownEvent({ identity: historicIdentity, time: timedAt(historicSpan.start, historicSpan.end) }),
    knownEvent({ identity: futureIdentity, time: timedAt(futureSpan.start, futureSpan.end) }),
  ]),
  mappings: mappingSet([
    mapping({ identity: historicIdentity, destinationId: "mirror-historic" }),
    mapping({ identity: futureIdentity, destinationId: "mirror-future" }),
  ]),
});

describe("coverage is proved per axis, never as one span", () => {
  test("RECON-O6: proving only the future axis deletes only the future absence", () => {
    const built = bothAbsent();

    const plan = planReconciliation(
      built.observed,
      built.known,
      built.mappings,
      policy({ coverage: futureAxisOnly }),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).identity.uid.value).toBe("evt-future");
  });

  test("RECON-O6: the historic absence is reported unresolved, not silently ignored", () => {
    const built = bothAbsent();

    const plan = planReconciliation(
      built.observed,
      built.known,
      built.mappings,
      policy({ coverage: futureAxisOnly }),
    );

    expect(plan.unresolved).toEqual([
      { identity: historicIdentity, id: null, reason: "outsideProvenCoverage" },
    ]);
  });

  test("RECON-O6: a wide future window does not vouch for a historic instant", () => {
    expect(
      insideProvenCoverage(
        futureAxisOnly,
        timedAt(historicSpan.start, historicSpan.end),
        defaultWindowMembership,
      ),
    ).toBe(false);
  });

  test("RECON-O6: the same coverage does vouch for a future instant", () => {
    expect(
      insideProvenCoverage(
        futureAxisOnly,
        timedAt(futureSpan.start, futureSpan.end),
        defaultWindowMembership,
      ),
    ).toBe(true);
  });
});

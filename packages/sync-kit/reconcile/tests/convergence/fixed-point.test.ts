import { describe, expect, test } from "vitest";
import { planReconciliation } from "../../src/index";
import { applyPlan } from "../support/apply";
import type { Scenario } from "../support/apply";
import {
  allDayOn,
  foreignEvent,
  indeterminateEvent,
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  masterIdentity,
  ourInstallation,
  ownedEvent,
  policy,
  recurringEvent,
  remoteId,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
  uid,
  unprovenPolicy,
} from "../support/fixtures";

const planFrom = (scenario: Scenario) =>
  planReconciliation(scenario.observed, scenario.known, scenario.mappings, scenario.policy);

const zeroDurationSpan = { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T09:00:00.000Z" };
const invertedSpan = { start: "2026-03-10T10:00:00.000Z", end: "2026-03-10T09:00:00.000Z" };

const degenerateShapes: readonly (readonly [string, () => Scenario])[] = [
  [
    "a zero-duration event",
    () => ({
        observed: sourceOnly(
          snapshotListing({
            events: [
              foreignEvent({
                id: "evt-zero",
                uid: "evt-zero",
                time: timedAt(zeroDurationSpan.start, zeroDurationSpan.end),
              }),
            ],
          }),
        ),
        known: knownState([]),
        mappings: mappingSet([]),
        policy: policy(),
    }),
  ],
  [
    "an inverted range",
    () => ({
      observed: sourceOnly(
        snapshotListing({
          events: [
            foreignEvent({
              id: "evt-inverted",
              uid: "evt-inverted",
              time: timedAt(invertedSpan.start, invertedSpan.end),
            }),
          ],
        }),
      ),
      known: knownState([]),
      mappings: mappingSet([]),
      policy: policy(),
    }),
  ],
  [
    "an all-day event off the UTC boundary",
    () => ({
      observed: sourceOnly(
        snapshotListing({
          events: [
            foreignEvent({
              id: "evt-allday",
              uid: "evt-allday",
              time: allDayOn("2026-03-10", "2026-03-11"),
            }),
          ],
        }),
      ),
      known: knownState([]),
      mappings: mappingSet([]),
      policy: policy(),
    }),
  ],
  [
    "a master anchored outside the window",
    () => ({
      observed: sourceOnly(
        snapshotListing({
          events: [
            recurringEvent(
              { id: "evt-series", uid: "evt-series" },
              "2024-01-08T09:00:00.000Z",
              "FREQ=WEEKLY;BYDAY=MO",
            ),
          ],
        }),
      ),
      known: knownState([]),
      mappings: mappingSet([]),
      policy: policy({
        mirrorWindow: { start: instant("2026-03-01T00:00:00.000Z"), end: instant("2026-04-01T00:00:00.000Z") },
      }),
    }),
  ],
  [
    "a withheld identity",
    () => {
      const identity = slotIdentity("evt-held", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
      return {
        observed: sourceOnly(
          snapshotListing({
            events: [],
            withheld: [{ uid: uid("evt-held"), id: remoteId("evt-held"), reason: "unparseable" }],
          }),
        ),
        known: knownState([knownEvent({ identity })]),
        mappings: mappingSet([mapping({ identity, destinationId: "mirror-held" })]),
        policy: policy(),
      };
    },
  ],
  [
    "an unresolved absence outside proven coverage",
    () => {
      const identity = slotIdentity("evt-gap", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
      return {
        observed: sourceOnly(snapshotListing({ events: [] })),
        known: knownState([knownEvent({ identity })]),
        mappings: mappingSet([mapping({ identity, destinationId: "mirror-gap" })]),
        policy: unprovenPolicy(),
      };
    },
  ],
  [
    "a conflicted mapping",
    () => {
      const identity = slotIdentity("evt-conflict", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
      return {
        observed: sourceOnly(
          snapshotListing({
            events: [
              foreignEvent({
                id: "evt-conflict",
                uid: "evt-conflict",
                fingerprint: "fp-new",
                version: "v2",
              }),
            ],
          }),
        ),
        known: knownState([knownEvent({ identity, fingerprint: "fp-old" })]),
        mappings: mappingSet([
          mapping({
            identity,
            destinationId: "mirror-conflict",
            sourceFingerprint: "fp-old",
            version: "v1",
          }),
        ]),
        policy: policy(),
      };
    },
  ],
  [
    "a re-identified occurrence",
    () => {
      const before = slotIdentity("series", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
      const afterSpan = { start: "2026-03-10T11:00:00.000Z", end: "2026-03-10T12:00:00.000Z" };
      return {
        observed: sourceOnly(
          snapshotListing({
            events: [
              foreignEvent({
                id: "series-1",
                uid: "series",
                time: timedAt(afterSpan.start, afterSpan.end),
                fingerprint: "fp-series",
              }),
            ],
          }),
        ),
        known: knownState([knownEvent({ identity: before, fingerprint: "fp-series", recurring: true })]),
        mappings: mappingSet([
          mapping({ identity: before, destinationId: "mirror-series", sourceFingerprint: "fp-series" }),
        ]),
        policy: policy(),
      };
    },
  ],
  [
    "a representation change that must be replaced",
    () => {
      const identity = slotIdentity("evt-shape", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
      return {
        observed: sourceOnly(
          snapshotListing({
            events: [
              foreignEvent({
                id: "evt-shape",
                uid: "evt-shape",
                time: allDayOn("2026-03-10", "2026-03-11"),
                fingerprint: "fp-allday",
              }),
            ],
          }),
        ),
        known: knownState([knownEvent({ identity, fingerprint: "fp-timed" })]),
        mappings: mappingSet([
          mapping({ identity, destinationId: "mirror-shape", sourceFingerprint: "fp-timed" }),
        ]),
        policy: policy(),
      };
    },
  ],
];

const isEmptyPlan = (plan: ReturnType<typeof planFrom>): boolean =>
  plan.writes.length === 0 && plan.tombstones.length === 0;

describe("reconciliation reaches a fixed point", () => {
  for (const entry of degenerateShapes) {
    const [name, build] = entry;

    test(`RECON-O20: ${name} converges after one application`, () => {
      const first = build();
      const firstPlan = planFrom(first);
      const second = applyPlan(first, firstPlan);
      const secondPlan = planFrom(second);
      const third = applyPlan(second, secondPlan);
      const thirdPlan = planFrom(third);

      expect(isEmptyPlan(secondPlan)).toBe(true);
      expect(isEmptyPlan(thirdPlan)).toBe(true);
    });
  }

  test("RECON-O20: at least one of the nine shapes has a non-empty first plan", () => {
    const nonEmptyFirstPlans = degenerateShapes.filter((entry) => !isEmptyPlan(planFrom(entry[1]())));

    expect(nonEmptyFirstPlans.length).toBeGreaterThanOrEqual(5);
  });

  test("RECON-O20: an already settled state never writes to a real calendar again", () => {
    const identity = slotIdentity("evt-settled", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
    const settled: Scenario = {
      observed: sourceOnly(
        snapshotListing({
          events: [foreignEvent({ id: "evt-settled", uid: "evt-settled", fingerprint: "fp-settled" })],
        }),
      ),
      known: knownState([knownEvent({ identity, fingerprint: "fp-settled" })]),
      mappings: mappingSet([
        mapping({ identity, destinationId: "mirror-settled", sourceFingerprint: "fp-settled" }),
      ]),
      policy: policy(),
    };

    for (let run = 0; run < 5; run++) {
      expect(isEmptyPlan(planFrom(settled))).toBe(true);
    }
  });

  test("RECON-O20: a mirror we already own and already agree with is never rewritten", () => {
    const identity = masterIdentity("evt-owned");
    const scenario: Scenario = {
      observed: sourceOnly(
        snapshotListing({
          events: [ownedEvent({ id: "evt-owned", uid: "evt-owned" }, ourInstallation)],
        }),
      ),
      known: knownState([knownEvent({ identity })]),
      mappings: mappingSet([mapping({ identity, destinationId: "mirror-owned" })]),
      policy: policy(),
    };

    expect(isEmptyPlan(planFrom(scenario))).toBe(true);
  });

  test("RECON-O20: an indeterminate event does not oscillate between runs", () => {
    const scenario: Scenario = {
      observed: sourceOnly(
        snapshotListing({ events: [indeterminateEvent({ id: "evt-?", uid: "evt-?" })] }),
      ),
      known: knownState([]),
      mappings: mappingSet([]),
      policy: policy(),
    };

    expect(JSON.stringify(planFrom(scenario))).toBe(JSON.stringify(planFrom(applyPlan(scenario, planFrom(scenario)))));
  });
});

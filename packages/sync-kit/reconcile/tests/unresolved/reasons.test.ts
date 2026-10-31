import { describe, expect, test } from "vitest";
import { planReconciliation, unresolvedReasons } from "../../src/index";
import {
  capabilities,
  deltaListing,
  foreignEvent,
  indeterminateEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
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

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const known = () => knownState([knownEvent({ identity, fingerprint: "fp-old" })]);
const mapped = () =>
  mappingSet([mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-old" })]);

const reasonsFrom = (
  observed: Parameters<typeof planReconciliation>[0],
  knownState_: Parameters<typeof planReconciliation>[1],
  mappings: Parameters<typeof planReconciliation>[2],
  policy_: Parameters<typeof planReconciliation>[3],
): readonly string[] =>
  planReconciliation(observed, knownState_, mappings, policy_).unresolved.map((item) => item.reason);

describe("every drop names its own reason", () => {
  test("RECON-I28: the reason set has eleven distinct members and no catch-all", () => {
    expect(new Set(unresolvedReasons).size).toBe(11);
    expect(unresolvedReasons).not.toContain("other");
    expect(unresolvedReasons).not.toContain("unknown");
  });

  test("withheldBySource is distinct from unsupportedByDestination", () => {
    const withheld = reasonsFrom(
      sourceOnly(
        snapshotListing({
          events: [],
          withheld: [{ uid: uid("evt-1"), id: remoteId("evt-1"), reason: "unsupportedRecurrenceRange" }],
        }),
      ),
      known(),
      mapped(),
      policy(),
    );
    const unsupported = reasonsFrom(
      sourceOnly(
        snapshotListing({
          events: [
            recurringEvent({ id: "evt-1", uid: "evt-1" }, "2026-03-10T09:00:00.000Z", "FREQ=WEEKLY"),
          ],
        }),
      ),
      known(),
      mapped(),
      policy({ capabilities: { ...capabilities, recurrenceWrite: "none" } }),
    );

    expect(withheld).toEqual(["withheldBySource"]);
    expect(unsupported).toEqual(["unsupportedByDestination"]);
  });

  test("outsideProvenCoverage is distinct from corruptKnownState", () => {
    const uncovered = reasonsFrom(
      sourceOnly(snapshotListing({ events: [] })),
      known(),
      mapped(),
      unprovenPolicy(),
    );
    const corrupt = reasonsFrom(
      sourceOnly(deltaListing({ events: [] })),
      knownState([knownEvent({ identity })], [{ id: remoteId("bad"), uid: null }]),
      mapped(),
      policy(),
    );

    expect(uncovered).toEqual(["outsideProvenCoverage"]);
    expect(corrupt).toEqual(["corruptKnownState"]);
  });

  test("provenanceIndeterminate is distinct from missingIdentity", () => {
    const indeterminate = reasonsFrom(
      sourceOnly(
        snapshotListing({
          events: [
            indeterminateEvent({
              id: "evt-1",
              uid: "evt-1",
              time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
            }),
          ],
        }),
      ),
      known(),
      mapped(),
      policy(),
    );
    const missing = reasonsFrom(
      sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-x", uid: "" })] })),
      knownState([]),
      mappingSet([]),
      policy(),
    );

    expect(indeterminate).toEqual(["provenanceIndeterminate"]);
    expect(missing).toEqual(["missingIdentity"]);
  });

  test("RECON-I28: an unsupported construct is reported, never coerced into a write", () => {
    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [
            recurringEvent({ id: "evt-1", uid: "evt-1" }, "2026-03-10T09:00:00.000Z", "FREQ=WEEKLY"),
          ],
        }),
      ),
      known(),
      mapped(),
      policy({ capabilities: { ...capabilities, recurrenceWrite: "none" } }),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });
});

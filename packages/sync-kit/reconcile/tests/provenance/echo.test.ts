import { describe, expect, test } from "vitest";
import { classifyProvenance, isRetirable, planReconciliation } from "../../src/index";
import {
  bothSides,
  destinationScope,
  foreignEvent,
  foreignInstallation,
  indeterminateEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  ourInstallation,
  ownedEvent,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const ourEchoInTheSource = () =>
  ownedEvent({ id: "evt-1", uid: "evt-1", title: "rewritten by the destination", fingerprint: "fp-rewritten" }, ourInstallation);

describe("provenance decides what may be written and what may be retired", () => {
  test("RECON-O13: an event in the source stamped as ours is never mirrored back", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [ourEchoInTheSource()] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O13: our own echo is not read as a user edit, so it raises no conflict", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [ourEchoInTheSource()] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.conflicts).toEqual([]);
  });

  test("RECON-O13: our own echo is not read as an absence either", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [ourEchoInTheSource()] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O14: a mirror stamped with another installation is never retired as an orphan", () => {
    const theirMirror = ownedEvent({ id: "mirror-foreign", uid: "mirror-foreign" }, foreignInstallation);

    const plan = planReconciliation(
      bothSides(
        snapshotListing({ events: [] }),
        snapshotListing({ events: [theirMirror], scope: destinationScope }),
      ),
      knownState([]),
      mappingSet([]),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(isRetirable(theirMirror, ourInstallation)).toBe(false);
  });

  test("RECON-O14: our own orphaned mirror IS retirable", () => {
    const ourMirror = ownedEvent({ id: "mirror-ours", uid: "mirror-ours" }, ourInstallation);

    expect(isRetirable(ourMirror, ourInstallation)).toBe(true);
    expect(classifyProvenance(ourMirror, ourInstallation)).toBe("ourMirror");
  });

  test("RECON-O15: an indeterminate destination event with no mapping is never deleted", () => {
    const unattributable = indeterminateEvent({ id: "mirror-mystery", uid: "mirror-mystery" });

    const plan = planReconciliation(
      bothSides(
        snapshotListing({ events: [] }),
        snapshotListing({ events: [unattributable], scope: destinationScope }),
      ),
      knownState([]),
      mappingSet([]),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.unresolved.map((item) => item.reason)).toContain("provenanceIndeterminate");
  });

  test("RECON-O15: an indeterminate event is classified distinctly from a foreign one", () => {
    const unattributable = indeterminateEvent({ id: "mirror-mystery", uid: "mirror-mystery" });
    const external = foreignEvent({ id: "mirror-external", uid: "mirror-external" });

    expect(classifyProvenance(unattributable, ourInstallation)).toBe("indeterminate");
    expect(classifyProvenance(external, ourInstallation)).toBe("external");
    expect(classifyProvenance(ownedEvent({ id: "m", uid: "m" }, foreignInstallation), ourInstallation)).toBe(
      "foreignInstallation",
    );
  });
});

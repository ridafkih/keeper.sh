import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import {
  allDayOn,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const timedIdentity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const becameAllDay = () =>
  foreignEvent({
    id: "evt-1",
    uid: "evt-1",
    time: allDayOn("2026-03-10", "2026-03-11"),
    fingerprint: "fp-allday",
  });

const scenario = () => ({
  observed: sourceOnly(snapshotListing({ events: [becameAllDay()] })),
  known: knownState([
    knownEvent({
      identity: timedIdentity,
      time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
    }),
  ]),
  mappings: mappingSet([mapping({ identity: timedIdentity, destinationId: "mirror-1" })]),
});

describe("a delete never lands without its recreate", () => {
  test("RECON-O16: a representation change is planned as one replace entry", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const replaces = plan.writes.filter((write) => write.kind === "replace");

    expect(replaces).toHaveLength(1);
  });

  test("RECON-O16: no plan expresses that delete independently of the recreate", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const standaloneDeletes = plan.writes.filter(
      (write) => write.kind === "single" && write.intent.kind === "delete",
    );

    expect(standaloneDeletes).toEqual([]);
  });

  test("RECON-O16: the replace targets the mapped mirror and recreates in the same calendar", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const replace = plan.writes.find((write) => write.kind === "replace");

    expect(replace?.retire.target.value).toBe("mirror-1");
    expect(replace?.recreate.calendar.key).toEqual(replace?.retire.calendar.key);
  });

  test("RECON-O16: the retire half still carries the mapping's precondition", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const replace = plan.writes.find((write) => write.kind === "replace");

    expect(replace?.retire.precondition).toEqual(firstOf(built.mappings.entries).precondition);
  });

  test("RECON-O16: no tombstone accompanies the replace, since the mapping must survive it", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.tombstones).toEqual([]);
  });
});

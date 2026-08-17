import { describe, expect, test } from "vitest";
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

const allDayIdentity = slotIdentity(
  "evt-allday",
  "2026-03-10T00:00:00.000Z",
  "2026-03-11T00:00:00.000Z",
);

const twentyFourHourIdentity = slotIdentity(
  "evt-24h",
  "2026-03-10T09:00:00.000Z",
  "2026-03-11T09:00:00.000Z",
);

describe("all-day-ness is read from the protocol discriminant, never re-derived", () => {
  test("RECON-I38: an allDay event and a 24h timed event are different identities", () => {
    expect(allDayIdentity).not.toEqual(twentyFourHourIdentity);
  });

  test("RECON-I38: a settled all-day event plans no write", () => {
    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [
            foreignEvent({
              id: "evt-allday",
              uid: "evt-allday",
              time: allDayOn("2026-03-10", "2026-03-11"),
              fingerprint: "fp-allday",
            }),
          ],
        }),
      ),
      knownState([knownEvent({ identity: allDayIdentity, fingerprint: "fp-allday" })]),
      mappingSet([
        mapping({ identity: allDayIdentity, destinationId: "mirror-allday", sourceFingerprint: "fp-allday" }),
      ]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
  });

  test("RECON-I38: a 24h non-midnight event is not treated as the all-day one", () => {
    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [
            foreignEvent({
              id: "evt-24h",
              uid: "evt-24h",
              time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-11T09:00:00.000Z"),
              fingerprint: "fp-24h",
            }),
          ],
        }),
      ),
      knownState([knownEvent({ identity: allDayIdentity, fingerprint: "fp-allday" })]),
      mappingSet([
        mapping({ identity: allDayIdentity, destinationId: "mirror-allday", sourceFingerprint: "fp-allday" }),
      ]),
      policy(),
    );

    expect(plan.writes).toHaveLength(1);
    expect(plan.tombstones).toHaveLength(1);
  });

  test("RECON-I49: no module under src resolves a timezone identifier", async () => {
    const { filesMatching } = await import("../support/sources");

    expect(await filesMatching("src", "resolveZoneIdentifier")).toEqual([]);
    expect(await filesMatching("src", "VTIMEZONE")).toEqual([]);
  });
});

import { describe, expect, test } from "vitest";
import type { EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";
import {
  decodeStoredCanonicalEvent,
  sourceCoverageFrom,
  synthesizeSourceListing,
  translateDestinationSync,
} from "../../src/index";
import { firstOf } from "../support/scenario";
import {
  asOf,
  completeRead,
  mirrorRow,
  mirrorWindow,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const inside = slotIdentity("evt-inside", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const wayBefore = slotIdentity("evt-past", "1999-03-10T09:00:00.000Z", "1999-03-10T10:00:00.000Z");
const wayAfter = slotIdentity("evt-later", "2099-03-10T09:00:00.000Z", "2099-03-10T10:00:00.000Z");

const provenProof = () =>
  sourceCoverageFrom({
    stored: storedCoverage(),
    mirrorWindow,
    asOf,
    maxCoverageAgeSeconds: 86_400,
  });

describe("the shadow applies no window predicate of its own", () => {
  test("SHADOW-I25: every event the caller supplies reaches the listing", () => {
    const listing = synthesizeSourceListing({
      sourceCalendar: sourceCalendarA,
      mirrorWindow,
      storedSourceEvents: [
        storedSourceEvent({ identity: inside }),
        storedSourceEvent({ identity: wayBefore, time: timedAt("1999-03-10T09:00:00.000Z", "1999-03-10T10:00:00.000Z") }),
        storedSourceEvent({ identity: wayAfter, time: timedAt("2099-03-10T09:00:00.000Z", "2099-03-10T10:00:00.000Z") }),
      ],
      completeness: completeRead(),
      proof: provenProof(),
      decodeStored: decodeStoredCanonicalEvent,
    });

    expect(listing.events.length).toBe(3);
    expect(listing.events.map((event) => event.uid.value).toSorted()).toEqual([
      "evt-inside",
      "evt-later",
      "evt-past",
    ]);
  });

  test("SHADOW-I25: the injected predicate is the only window judgement made", () => {
    const seen: string[] = [];
    const recordingPredicate: WindowMembership = (window: TimeWindow, time: EventTime) => {
      seen.push(`${window.start.value}|${time.kind}`);
      return true;
    };
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity: inside })],
        mirrors: [mirrorRow({ identity: inside })],
      }),
      shadowOptions({ withinWindow: recordingPredicate }),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }

    expect(firstOf(translation.units).policy.withinWindow).toBe(recordingPredicate);
    expect(seen.length).toBe(0);
  });
});

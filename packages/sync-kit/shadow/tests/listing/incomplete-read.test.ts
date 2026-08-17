import { describe, expect, test } from "vitest";
import type { WithheldEvent } from "@keeper.sh/sync-protocol";
import {
  decodeStoredCanonicalEvent,
  readIsComplete,
  sourceCoverageFrom,
  synthesizeSourceListing,
  withholdingCounters,
} from "../../src/index";
import { uid } from "../support/handles";
import { cataloged, runShadow } from "../support/scenario";
import {
  asOf,
  completeRead,
  incompleteRead,
  mirrorRow,
  mirrorWindow,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  withheldFrom,
  zeroedCounters,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const seriesIdentity = slotIdentity(
  "evt-series",
  "2026-03-12T09:00:00.000Z",
  "2026-03-12T10:00:00.000Z",
);

const withheldSeries: WithheldEvent = {
  uid: uid("evt-series"),
  id: null,
  reason: "recurrenceBudgetExceeded",
};

const provenProof = () =>
  sourceCoverageFrom({
    stored: storedCoverage(),
    mirrorWindow,
    asOf,
    maxCoverageAgeSeconds: 86_400,
  });

describe("an incomplete local read cannot claim a snapshot", () => {
  test("SHADOW-I9: any non-zero withholding counter downgrades the listing to partial", () => {
    for (const counter of withholdingCounters) {
      const listing = synthesizeSourceListing({
        sourceCalendar: sourceCalendarA,
        mirrorWindow,
        storedSourceEvents: [storedSourceEvent({ identity })],
        completeness: {
          withheldCounts: { ...zeroedCounters(), [counter]: 1 },
          withheld: withheldFrom([withheldSeries]),
        },
        proof: provenProof(),
        decodeStored: decodeStoredCanonicalEvent,
      });

      expect(`${counter}:${listing.kind}`).toBe(`${counter}:partial`);
    }
  });

  test("SHADOW-I9: a fully zeroed read under a proof is a snapshot", () => {
    const listing = synthesizeSourceListing({
      sourceCalendar: sourceCalendarA,
      mirrorWindow,
      storedSourceEvents: [storedSourceEvent({ identity })],
      completeness: completeRead(),
      proof: provenProof(),
      decodeStored: decodeStoredCanonicalEvent,
    });

    expect(listing.kind).toBe("snapshot");
    expect(readIsComplete(completeRead())).toBe(true);
  });

  test("SHADOW-I9: readIsComplete is false the moment any single counter moves", () => {
    for (const counter of withholdingCounters) {
      expect(
        readIsComplete({
          withheldCounts: { ...zeroedCounters(), [counter]: 1 },
          withheld: withheldFrom([withheldSeries]),
        }),
      ).toBe(false);
    }
  });

  test("SHADOW-I9: withheld identities reach the plan as withheldBySource", () => {
    const catalog = cataloged(
      runShadow(
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity })],
          mirrors: [mirrorRow({ identity }), mirrorRow({ identity: seriesIdentity })],
          completeness: incompleteRead("overBudgetRecurrenceSeries", withheldFrom([withheldSeries])),
        }),
        shadowOptions(),
      ),
    );
    const reasons = catalog.unresolved.map((entry) => entry.reason);

    expect(reasons).toContain("withheldBySource");
    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-I9: a counter that disagrees with the withheld list refuses the translation", () => {
    const catalog = runShadow(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        completeness: { withheldCounts: { ...zeroedCounters(), overBudgetRecurrenceSeries: 3 }, withheld: [] },
      }),
      shadowOptions(),
    );

    expect(catalog.kind).toBe("notTranslated");
    if (catalog.kind !== "notTranslated") {
      throw new Error("expected a refusal");
    }
    expect(catalog.reason).toBe("withheldCountsDisagreeWithWithheldList");
  });
});

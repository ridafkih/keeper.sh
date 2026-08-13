import { describe, expect, it } from "vitest";
import {
  BASE_SOURCE_SYNC_RANGES,
  getConfigurableSyncWindow,
} from "@keeper.sh/calendar";
import type { StoredDestinationRanges } from "@keeper.sh/calendar";
import { buildSourceIngestionPlan } from "../../src/utils/source-ingestion-ranges";

const SOURCE_CALENDAR_ID = "source-1";
const NOW = new Date("2026-03-08T12:00:00.000Z");

const readerFor = (
  destinations: StoredDestinationRanges[],
): ((sourceCalendarId: string) => Promise<StoredDestinationRanges[]>) =>
  () => Promise.resolve(destinations);

describe("buildSourceIngestionPlan", () => {
  it("covers the widest range configured across a source's destinations", async () => {
    const plan = await buildSourceIngestionPlan(
      SOURCE_CALENDAR_ID,
      readerFor([
        { syncFutureRange: "1_month", syncHistoricRange: "12_months" },
        { syncFutureRange: "2_years", syncHistoricRange: "3_months" },
      ]),
      NOW,
    );

    expect(plan.historicRange).toBe("12_months");
    expect(plan.futureRange).toBe("2_years");
    expect(plan.window).toEqual(getConfigurableSyncWindow("12_months", "2_years", NOW));
  });

  it("keeps the shared baseline when every destination is narrower", async () => {
    const plan = await buildSourceIngestionPlan(
      SOURCE_CALENDAR_ID,
      readerFor([{ syncFutureRange: "1_week", syncHistoricRange: "1_week" }]),
      NOW,
    );

    expect(plan.historicRange).toBe(BASE_SOURCE_SYNC_RANGES.historicRange);
    expect(plan.futureRange).toBe(BASE_SOURCE_SYNC_RANGES.futureRange);
  });

  it("falls back to the baseline when the source has no destinations", async () => {
    const plan = await buildSourceIngestionPlan(
      SOURCE_CALENDAR_ID,
      readerFor([]),
      NOW,
    );

    expect(plan.historicRange).toBe(BASE_SOURCE_SYNC_RANGES.historicRange);
    expect(plan.futureRange).toBe(BASE_SOURCE_SYNC_RANGES.futureRange);
  });

  it("reads the ranges for the source being ingested", async () => {
    const requested: string[] = [];

    await buildSourceIngestionPlan(
      SOURCE_CALENDAR_ID,
      (sourceCalendarId) => {
        requested.push(sourceCalendarId);
        return Promise.resolve([]);
      },
      NOW,
    );

    expect(requested).toEqual([SOURCE_CALENDAR_ID]);
  });
});

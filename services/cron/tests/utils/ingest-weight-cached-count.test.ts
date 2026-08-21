import { describe, expect, it, vi } from "vitest";
import {
  BYTES_PER_EVENT,
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
  estimateIngestWeight,
} from "../../src/utils/ingest-weight";

const NEVER_INGESTED_DEFAULT = 2048 * 1024;

describe("estimateIngestWeight with a cached stored-event count", () => {
  it("weighs by the cached count without calling the count dependency", async () => {
    const countStoredEventsMock = vi.fn(() => Promise.resolve(50));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-cached",
      true,
      300,
    );

    expect(weight).toBe(300 * BYTES_PER_EVENT);
    expect(countStoredEventsMock).not.toHaveBeenCalled();
  });
});

describe("estimateIngestWeight when the cached count is absent", () => {
  it("falls back to counting stored events when the cached count is null", async () => {
    const countStoredEventsMock = vi.fn(() => Promise.resolve(200));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-uncached",
      true,
      null,
    );

    expect(countStoredEventsMock).toHaveBeenCalledWith("calendar-uncached");
    expect(weight).toBe(200 * BYTES_PER_EVENT);
  });

  it("keeps the never-ingested fallback when the fallback count read fails", async () => {
    const countStoredEventsMock = vi.fn(() =>
      Promise.reject(new Error("connection reset")),
    );

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-uncached-flaky",
      true,
      null,
    );

    expect(weight).toBe(NEVER_INGESTED_DEFAULT);
  });
});

describe("estimateIngestWeight clamping parity between cached and counted paths", () => {
  const representativeCounts = [0, 10, 2048, 1_000_000];

  it.each(representativeCounts)(
    "gives the cached path the identical clamped weight for a stored count of %i",
    async (storedCount) => {
      const expected = Math.min(
        Math.max(storedCount * BYTES_PER_EVENT, WEIGHT_FLOOR),
        WEIGHT_BUDGET,
      );
      const countedWeight = await estimateIngestWeight(
        { countStoredEvents: vi.fn(() => Promise.resolve(storedCount)) },
        "calendar-counted",
        true,
      );
      const cachedWeight = await estimateIngestWeight(
        { countStoredEvents: vi.fn(() => Promise.resolve(0)) },
        "calendar-cached",
        true,
        storedCount,
      );

      expect(countedWeight).toBe(expected);
      expect(cachedWeight).toBe(expected);
    },
  );

  it("pins the floor, cap, and never-ingested numbers exactly", async () => {
    const dependencies = { countStoredEvents: vi.fn(() => Promise.resolve(0)) };

    expect(await estimateIngestWeight(dependencies, "c", true, 0)).toBe(16_384);
    expect(await estimateIngestWeight(dependencies, "c", true, 10)).toBe(16_384);
    expect(await estimateIngestWeight(dependencies, "c", true, 2048)).toBe(2048 * 1024);
    expect(await estimateIngestWeight(dependencies, "c", true, 1_000_000)).toBe(536_870_912);
    expect(await estimateIngestWeight(dependencies, "c", false, 1_000_000))
      .toBe(NEVER_INGESTED_DEFAULT);
    expect(dependencies.countStoredEvents).not.toHaveBeenCalled();
  });
});

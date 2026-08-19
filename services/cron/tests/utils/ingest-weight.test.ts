import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { eventStatesTable } from "@keeper.sh/database/schema";
import {
  BYTES_PER_EVENT,
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
  countStoredEvents,
  estimateIngestWeight,
} from "../../src/utils/ingest-weight";

/*
 * The permit is sized BEFORE the fetch, so the estimate can only come from the
 * previous ingest's stored count. Calendars vary by two-plus orders of
 * magnitude, so a count-based limit cannot bound memory; a byte weight can.
 */

const NEVER_INGESTED_DEFAULT = WEIGHT_BUDGET / 8;

describe("estimateIngestWeight constants", () => {
  it("pins the named weight constants", () => {
    expect(BYTES_PER_EVENT).toBe(1024);
    expect(WEIGHT_FLOOR).toBe(16_384);
    // 64MB: 64 * 1024 * 1024.
    expect(WEIGHT_BUDGET).toBe(67_108_864);
  });
});

describe("estimateIngestWeight for calendars that have ingested before", () => {
  it("weighs by stored count times bytes per event", async () => {
    const countStoredEventsMock = vi.fn(() => Promise.resolve(300));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-1",
      true,
    );

    expect(countStoredEventsMock).toHaveBeenCalledWith("calendar-1");
    expect(weight).toBe(300 * BYTES_PER_EVENT);
  });

  it("clamps a tiny calendar up to the weight floor", async () => {
    const countStoredEventsMock = vi.fn(() => Promise.resolve(3));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-tiny",
      true,
    );

    expect(weight).toBe(WEIGHT_FLOOR);
  });

  it("clamps a huge calendar down to the full budget", async () => {
    const countStoredEventsMock = vi.fn(() => Promise.resolve(1_000_000));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-huge",
      true,
    );

    expect(weight).toBe(WEIGHT_BUDGET);
  });
});

describe("estimateIngestWeight for never-ingested calendars", () => {
  it("returns an eighth of the budget regardless of stored count", async () => {
    /* Budget/8 self-limits a flood of unknown-size first ingests to ~8 at a time. */
    const countStoredEventsMock = vi.fn(() => Promise.resolve(1_000_000));

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-new",
      false,
    );

    expect(weight).toBe(NEVER_INGESTED_DEFAULT);
  });
});

describe("estimateIngestWeight when the count read fails", () => {
  it("falls back to the never-ingested default instead of failing the ingest", async () => {
    const countStoredEventsMock = vi.fn(() =>
      Promise.reject(new Error("connection reset")),
    );

    const weight = await estimateIngestWeight(
      { countStoredEvents: countStoredEventsMock },
      "calendar-flaky",
      true,
    );

    expect(weight).toBe(NEVER_INGESTED_DEFAULT);
  });
});

describe("countStoredEvents", () => {
  it("counts event states for the calendar against the injected database", async () => {
    const fromMock = vi.fn();
    const whereMock = vi.fn(() => Promise.resolve([{ count: 42 }]));
    const selectMock = vi.fn(() => ({
      from: fromMock.mockReturnValue({ where: whereMock }),
    }));
    const database = { select: selectMock };

    const stored = await countStoredEvents(database as never, "calendar-9");

    expect(stored).toBe(42);
    expect(fromMock).toHaveBeenCalledWith(eventStatesTable);
    expect(whereMock).toHaveBeenCalledWith(
      eq(eventStatesTable.calendarId, "calendar-9"),
    );
  });
});

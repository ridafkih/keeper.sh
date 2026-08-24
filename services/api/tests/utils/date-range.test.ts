import { describe, expect, it } from "vitest";

import { normalizeDateRange, parseDateRangeParams } from "@/utils/date-range";

describe("normalizeDateRange", () => {
  it("honours the exact instants supplied by the caller", () => {
    // Regression guard against setHours(0/23) widening narrow ranges to a full local day.
    const from = new Date("2026-05-18T03:00:00.000Z");
    const to = new Date("2026-05-19T02:59:59.000Z");

    const { start, end } = normalizeDateRange(from, to);

    expect(start.toISOString()).toBe("2026-05-18T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-05-19T02:59:59.000Z");
  });

  it("returns fresh Date instances (callers may mutate them)", () => {
    const from = new Date("2026-05-18T00:00:00.000Z");
    const to = new Date("2026-05-25T00:00:00.000Z");

    const { start, end } = normalizeDateRange(from, to);

    expect(start).not.toBe(from);
    expect(end).not.toBe(to);
  });

  it("rejects an invalid bound", () => {
    expect(() => normalizeDateRange(
      new Date("invalid"),
      new Date("2026-05-25T00:00:00.000Z"),
    )).toThrow("Event range requires valid from and to dates");
  });

  it("rejects an empty or reversed range", () => {
    expect(() => normalizeDateRange(
      new Date("2026-05-25T00:00:00.000Z"),
      new Date("2026-05-18T00:00:00.000Z"),
    )).toThrow("Event range requires from to be before to");
  });

  it("rejects a range longer than the materialization budget", () => {
    expect(() => normalizeDateRange(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2028-01-04T00:00:00.000Z"),
    )).toThrow("Event range cannot exceed 732 days");
  });
});

describe("parseDateRangeParams", () => {
  it("parses ?from and ?to as exact ISO 8601 instants", () => {
    const url = new URL(
      "https://example.test/api/events?from=2026-05-18T03:00:00.000Z&to=2026-05-19T02:59:59.000Z",
    );

    const { from, to } = parseDateRangeParams(url);

    expect(from.toISOString()).toBe("2026-05-18T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-05-19T02:59:59.000Z");
  });

  it("defaults `to` to one week after `from` when only `from` is supplied", () => {
    const url = new URL(
      "https://example.test/api/events?from=2026-05-18T00:00:00.000Z",
    );

    const { from, to } = parseDateRangeParams(url);

    expect(from.toISOString()).toBe("2026-05-18T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });
});

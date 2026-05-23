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

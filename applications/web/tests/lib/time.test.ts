import { describe, expect, it } from "vitest";
import { resolveEventDay } from "../../src/lib/time";

describe("resolveEventDay", () => {
  it("uses the UTC date for all-day events instead of the local wall clock", () => {
    const start = new Date("2026-08-20T00:00:00.000Z");
    const day = resolveEventDay(start, true);

    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(7);
    expect(day.getDate()).toBe(20);
    expect(day.getHours()).toBe(0);
  });

  it("uses the local calendar day for timed events", () => {
    const start = new Date("2026-08-20T00:00:00.000Z");
    const day = resolveEventDay(start, false);

    expect(day.getFullYear()).toBe(start.getFullYear());
    expect(day.getMonth()).toBe(start.getMonth());
    expect(day.getDate()).toBe(start.getDate());
    expect(day.getHours()).toBe(0);
  });
});

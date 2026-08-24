import { describe, expect, it } from "vitest";
import { sweep, SWEEP_TIMEOUT_MS } from "./tz-sweep-support";

describe("resolving a wall time near every transition IANA declares", () => {
  it("holds for the historical offsets carrying whole minutes and seconds", () => {
    const outcome = sweep(
      [
        "Africa/Monrovia",
        "America/St_Johns",
        "Asia/Kolkata",
        "Asia/Kathmandu",
        "Australia/Lord_Howe",
        "Europe/Amsterdam",
        "Europe/Dublin",
        "Europe/Lisbon",
        "Europe/Moscow",
        "Pacific/Apia",
        "Pacific/Chatham",
      ],
      Date.UTC(1901, 0, 1),
      Date.UTC(1980, 0, 1),
    );

    expect(outcome.mismatches).toEqual([]);
    expect(outcome.checked).toBeGreaterThan(1000);
  }, SWEEP_TIMEOUT_MS);
});

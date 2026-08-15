import { describe, expect, it } from "vitest";
import { ALL_TIME_ZONES, sweep, SWEEP_TIMEOUT_MS } from "./tz-sweep-support";

describe("resolving a wall time near every transition IANA declares", () => {
  it("names the same instant a two-offset derivation does, in every zone", () => {
    const outcome = sweep(
      ALL_TIME_ZONES,
      Date.UTC(2024, 0, 1),
      Date.UTC(2032, 0, 1),
    );

    expect(outcome.mismatches).toEqual([]);
    expect(outcome.zonesWithTransitions).toBeGreaterThan(100);
    expect(outcome.checked).toBeGreaterThan(10_000);
  }, SWEEP_TIMEOUT_MS);
});

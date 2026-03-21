import { describe, expect, it } from "bun:test";
import { computeDestinationBackoff } from "./destination-backoff";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

describe("computeDestinationBackoff", () => {
  it("returns a 5-minute delay for the first failure", () => {
    const result = computeDestinationBackoff(1);
    expect(result.delayMs).toBe(FIVE_MINUTES_MS);
    expect(result.shouldDisable).toBe(false);
  });

  it("doubles the delay for each subsequent failure", () => {
    const first = computeDestinationBackoff(1);
    const second = computeDestinationBackoff(2);
    const third = computeDestinationBackoff(3);

    expect(second.delayMs).toBe(first.delayMs * 2);
    expect(third.delayMs).toBe(second.delayMs * 2);
  });

  it("marks shouldDisable when uncapped delay reaches 24 hours", () => {
    let failureCount = 1;
    let result = computeDestinationBackoff(failureCount);

    while (!result.shouldDisable) {
      failureCount++;
      result = computeDestinationBackoff(failureCount);
    }

    expect(result.delayMs).toBe(TWENTY_FOUR_HOURS_MS);
    expect(result.shouldDisable).toBe(true);
  });

  it("caps delay at 24 hours", () => {
    const result = computeDestinationBackoff(20);
    expect(result.delayMs).toBe(TWENTY_FOUR_HOURS_MS);
    expect(result.shouldDisable).toBe(true);
  });

  it("does not mark shouldDisable before delay reaches 24 hours", () => {
    let failureCount = 1;
    let result = computeDestinationBackoff(failureCount);

    while (result.delayMs < TWENTY_FOUR_HOURS_MS) {
      expect(result.shouldDisable).toBe(false);
      failureCount++;
      result = computeDestinationBackoff(failureCount);
    }
  });

  it("returns shouldDisable for zero or negative failure counts", () => {
    const zero = computeDestinationBackoff(0);
    expect(zero.delayMs).toBe(0);
    expect(zero.shouldDisable).toBe(false);
  });
});

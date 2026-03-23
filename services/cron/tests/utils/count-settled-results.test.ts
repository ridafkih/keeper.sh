import { describe, expect, it } from "bun:test";
import { countSettledResults } from "../../src/utils/count-settled-results";

describe("countSettledResults", () => {
  it("counts all fulfilled results as succeeded", () => {
    const results: PromiseSettledResult<string>[] = [
      { status: "fulfilled", value: "a" },
      { status: "fulfilled", value: "b" },
    ];

    expect(countSettledResults(results)).toEqual({ succeeded: 2, failed: 0 });
  });

  it("counts all rejected results as failed", () => {
    const results: PromiseSettledResult<string>[] = [
      { status: "rejected", reason: new Error("x") },
      { status: "rejected", reason: new Error("y") },
    ];

    expect(countSettledResults(results)).toEqual({ succeeded: 0, failed: 2 });
  });

  it("counts a mix of fulfilled and rejected results", () => {
    const results: PromiseSettledResult<number>[] = [
      { status: "fulfilled", value: 1 },
      { status: "rejected", reason: new Error("fail") },
      { status: "fulfilled", value: 2 },
      { status: "rejected", reason: new Error("fail") },
      { status: "fulfilled", value: 3 },
    ];

    expect(countSettledResults(results)).toEqual({ succeeded: 3, failed: 2 });
  });

  it("returns zeros for an empty array", () => {
    expect(countSettledResults([])).toEqual({ succeeded: 0, failed: 0 });
  });
});

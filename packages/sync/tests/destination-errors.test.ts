import { describe, expect, it } from "vitest";
import { isBackoffEligibleError } from "../src/destination-errors";

describe("isBackoffEligibleError", () => {
  it("matches invalid credentials", () => {
    expect(isBackoffEligibleError(new Error("Invalid credentials"))).toBe(true);
  });

  it("matches 404 not found from collection query", () => {
    const message = "Collection query failed: 404 Not Found. Raw response: The requested resource could not be found.";
    expect(isBackoffEligibleError(new Error(message))).toBe(true);
  });

  it("matches cannot find homeUrl", () => {
    expect(isBackoffEligibleError(new Error("cannot find homeUrl"))).toBe(true);
  });

  it("does not match transient 500 errors", () => {
    const message = "Collection query failed: 500 Internal Server Error. Raw response: <html>500</html>";
    expect(isBackoffEligibleError(new Error(message))).toBe(false);
  });

  it("does not match JSON parse errors", () => {
    expect(isBackoffEligibleError(new SyntaxError("Failed to parse JSON"))).toBe(false);
  });

  it("does not match unknown errors", () => {
    expect(isBackoffEligibleError(new Error("something unexpected"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isBackoffEligibleError("Invalid credentials")).toBe(true);
    expect(isBackoffEligibleError("random string")).toBe(false);
  });
});

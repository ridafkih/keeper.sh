import { describe, expect, it } from "vitest";
import { loggedIdentifierFor } from "../../../src/core/telemetry/logged-identifier";

describe("loggedIdentifierFor", () => {
  it("is the first sixteen hex characters of the value's SHA-256", () => {
    expect(loggedIdentifierFor("ada@example.com")).toBe("b5fc85e55755f9e0");
  });

  it("gives one value the same identifier every time", () => {
    expect(loggedIdentifierFor("mtg@test")).toBe(loggedIdentifierFor("mtg@test"));
  });

  it("tells two values apart", () => {
    expect(loggedIdentifierFor("mtg@test")).not.toBe(loggedIdentifierFor("mtg@test "));
  });

  it("does not grow with the value", () => {
    expect(loggedIdentifierFor("x".repeat(9000))).toHaveLength(16);
  });
});

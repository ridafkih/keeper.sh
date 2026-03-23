import { describe, expect, it } from "bun:test";
import { generateEventUid, isKeeperEvent } from "../../../src/core/events/identity";

describe("generateEventUid", () => {
  it("ends with the keeper event suffix", () => {
    const uid = generateEventUid();
    expect(uid.endsWith("@keeper.sh")).toBe(true);
  });

  it("generates unique UIDs on each call", () => {
    const uid1 = generateEventUid();
    const uid2 = generateEventUid();
    expect(uid1).not.toBe(uid2);
  });
});

describe("isKeeperEvent", () => {
  it("returns true for UIDs ending with @keeper.sh", () => {
    expect(isKeeperEvent("abc-123@keeper.sh")).toBe(true);
  });

  it("returns false for UIDs without the keeper suffix", () => {
    expect(isKeeperEvent("abc-123@google.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isKeeperEvent("")).toBe(false);
  });

  it("returns false when suffix appears in the middle", () => {
    expect(isKeeperEvent("@keeper.sh-extra")).toBe(false);
  });
});

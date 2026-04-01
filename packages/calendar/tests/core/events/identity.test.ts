import { describe, expect, it } from "bun:test";
import { generateDeterministicEventUid, isKeeperEvent } from "../../../src/core/events/identity";

describe("generateDeterministicEventUid", () => {
  it("ends with the keeper event suffix", () => {
    const uid = generateDeterministicEventUid("test-seed");
    expect(uid.endsWith("@keeper.sh")).toBe(true);
  });

  it("produces the same UID for the same seed", () => {
    const uid1 = generateDeterministicEventUid("same-seed");
    const uid2 = generateDeterministicEventUid("same-seed");
    expect(uid1).toBe(uid2);
  });

  it("produces different UIDs for different seeds", () => {
    const uid1 = generateDeterministicEventUid("seed-a");
    const uid2 = generateDeterministicEventUid("seed-b");
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

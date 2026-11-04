import { describe, expect, it } from "vitest";
import { resolveCopiesVersion } from "../../../src/features/onboarding/copies-version";

const mappings = { failingCount: 0, pendingCount: 1, seq: 3 };

describe("resolveCopiesVersion", () => {
  it("stays put while only progress moves", () => {
    const first = resolveCopiesVersion({ mappings, state: "syncing" });
    const later = resolveCopiesVersion({ mappings, state: "syncing" });

    expect(later).toBe(first);
  });

  it("changes when a run finishes or the mapping state moves", () => {
    const syncing = resolveCopiesVersion({ mappings, state: "syncing" });

    expect(resolveCopiesVersion({ mappings, state: "idle" })).not.toBe(syncing);
    expect(resolveCopiesVersion({ mappings: { ...mappings, seq: 4 }, state: "syncing" })).not.toBe(syncing);
  });
});

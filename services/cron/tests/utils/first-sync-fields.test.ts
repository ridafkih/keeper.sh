import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/utils/logging", () => ({
  widelog: {
    set: (key: string, value: unknown) => {
      recorded.set(key, value);
    },
  },
}));

const { recordPendingFirstSyncs } = await import("../../src/utils/first-sync-fields");

describe("recordPendingFirstSyncs", () => {
  beforeEach(() => {
    recorded.clear();
  });

  it("marks an ingest whose source still owes a mapping its first sync", () => {
    recordPendingFirstSyncs(2);

    expect(recorded.get("first_sync.pending_mapping_count")).toBe(2);
  });

  it("adds nothing for a source whose mappings have all synced", () => {
    recordPendingFirstSyncs(0);

    expect(recorded.size).toBe(0);
  });
});

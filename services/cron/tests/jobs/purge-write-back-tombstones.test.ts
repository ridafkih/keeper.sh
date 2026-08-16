import { describe, expect, it, vi } from "vitest";

const recorded: Record<string, unknown> = {};

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    max: () => null,
    min: () => null,
    set: (key: string, value: unknown) => {
      recorded[key] = value;
    },
  },
}));

const { runPurgeWriteBackTombstonesJob } = await import(
  "@/jobs/purge-write-back-tombstones"
);

const NOW = new Date("2027-06-01T00:00:00.000Z");

describe("the record of a deleted event does not outlive its retention window", () => {
  it("expires every tombstone whose window has closed", async () => {
    const cutoffs: Date[] = [];

    await runPurgeWriteBackTombstonesJob({
      deleteExpiredTombstones: (now) => {
        cutoffs.push(now);
        return Promise.resolve(3);
      },
      now: () => NOW,
    });

    expect(cutoffs).toEqual([NOW]);
    expect(recorded["tombstones.purged_count"]).toBe(3);
  });
});

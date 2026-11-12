import { describe, expect, it } from "vitest";
import type { SyncSummary } from "@keeper.sh/data-schemas";
import { describeAccountRemoval } from "../../../../src/features/dashboard/components/account-removal";
import { createSyncDraft } from "../../../../src/features/syncs/sync-draft";

const sync = (id: string, overrides: Partial<SyncSummary>): SyncSummary => ({
  ...createSyncDraft(null),
  copiedCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  id,
  lastSyncedAt: null,
  name: id,
  pairCount: 1,
  skippedCount: 0,
  state: "ok",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("describeAccountRemoval", () => {
  it("names the syncs that lose calendars and the ones left unable to run", () => {
    const syncs = [
      sync("Block My Time", { memberCalendarIds: ["work", "home"], mode: "both_ways" }),
      sync("Family", { destinationCalendarIds: ["family", "home"], sourceCalendarIds: ["personal"] }),
      sync("Untouched", { destinationCalendarIds: ["family"], sourceCalendarIds: ["personal"] }),
    ];

    expect(describeAccountRemoval(syncs, ["work", "home"])).toBe(
      "This removes the account and all its calendars from Keeper.sh. Block My Time and Family stop copying to and from them. Block My Time is left without enough calendars to run.",
    );
  });

  it("stays general before the syncs have loaded, and plain when none are affected", () => {
    expect(describeAccountRemoval(undefined, ["work"])).toContain("Any syncs using them");
    expect(describeAccountRemoval([sync("Other", { sourceCalendarIds: ["a"], destinationCalendarIds: ["b"] })], ["work"]))
      .toBe("This removes the account and all its calendars from Keeper.sh.");
  });
});

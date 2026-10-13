import { describe, expect, it } from "vitest";
import type { SyncSummary } from "@keeper.sh/data-schemas";
import {
  applyTemplate,
  createEmptyDraft,
  markPending,
  reconcileSources,
  resolveAddToSyncTargets,
  resolveConnectedAccount,
  seedFirstConnect,
  withSync,
  type SetupDraft,
} from "../../../src/features/setup/setup-draft";
import { createSyncDraft } from "../../../src/features/syncs/sync-draft";
import { makeSource } from "./fixtures";

const googleCalendars = [
  makeSource("primary", "google-account", ["pull", "push"], { name: "Primary" }),
  makeSource("family", "google-account", ["pull", "push"], { name: "Family" }),
  makeSource("team", "google-account", ["pull", "push"], { name: "Team" }),
];

const byId = (sources: ReturnType<typeof makeSource>[]) => new Map(sources.map((source) => [source.id, source] as const));

const oneWay = (sourceIds: string[], destinationIds: string[], name = ""): SetupDraft =>
  withSync(createEmptyDraft(), createSyncDraft(null, { destinationCalendarIds: destinationIds, name, sourceCalendarIds: sourceIds }));

const summary = (overrides: Partial<SyncSummary>): SyncSummary => ({
  ...createSyncDraft(null),
  copiedCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  id: "sync-1",
  lastSyncedAt: null,
  name: "Work to Personal",
  pairCount: 1,
  skippedCount: 0,
  state: "ok",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("the login import sequence", () => {
  it("seeds a two-calendar Block My Time once the imported calendars arrive, and the account id adds nothing more", () => {
    const seeded = seedFirstConnect(reconcileSources(createEmptyDraft(), googleCalendars), googleCalendars, 0);
    expect(seeded.firstConnect).toBe(true);
    expect(seeded.sync.mode).toBe("both_ways");
    expect(seeded.sync.memberCalendarIds).toEqual(["primary", "family"]);

    const revisited = resolveConnectedAccount(seeded, googleCalendars, "google-account");
    expect(revisited.sync.memberCalendarIds).toEqual(["primary", "family"]);
  });

  it("seeds a free user without the Pro-only skips", () => {
    const seeded = seedFirstConnect(createEmptyDraft(), googleCalendars, 0, false);
    expect(seeded.sync.memberCalendarIds).toEqual(["primary", "family"]);
    expect(seeded.sync.skipAllDay).toBe(false);
    expect(seeded.sync.skipFocusTime).toBe(false);
    expect(seeded.sync.shareAs).toBe("busy_only");
  });

  it("leaves the draft alone for a user who already has a sync", () => {
    const draft = createEmptyDraft();
    expect(seedFirstConnect(draft, googleCalendars, 1)).toBe(draft);
  });
});

describe("coming back from a connect", () => {
  const sources = [
    makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
    makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
  ];

  it("fills the blank the user left, then forgets it", () => {
    const left = markPending(oneWay(["work"], []), "destination");
    const back = resolveConnectedAccount(left, sources, "outlook-account");
    expect(back.sync.destinationCalendarIds).toEqual(["personal"]);
    expect(back.pending).toBeNull();
    expect(back.connectedAccountId).toBe("outlook-account");
  });

  it("falls back to the next useful blank without one", () => {
    const back = resolveConnectedAccount(oneWay(["work"], []), sources, "outlook-account");
    expect(back.sync.destinationCalendarIds).toEqual(["personal"]);
  });

  it("drops calendars that were removed meanwhile", () => {
    const stale = markPending(oneWay(["work", "gone"], ["also-gone"]), "source");
    const reconciled = reconcileSources(stale, sources);
    expect(reconciled.sync.sourceCalendarIds).toEqual(["work"]);
    expect(reconciled.sync.destinationCalendarIds).toEqual([]);
    expect(reconciled.pending).toBeNull();
  });
});

describe("applyTemplate", () => {
  const sources = [
    makeSource("work", "google-account", ["pull", "push"], { name: "Work" }),
    makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal" }),
  ];

  it("keeps the calendars already picked, moving them into the profile's direction", () => {
    const next = applyTemplate(oneWay(["work"], ["personal"]), "block_my_time", byId(sources), false);
    expect(next.sync.mode).toBe("both_ways");
    expect(next.sync.memberCalendarIds).toEqual(["work", "personal"]);
    expect(next.sync.name).toBe("Block My Time");
    expect(next.sync.skipAllDay).toBe(true);
  });

  it("keeps a name the user typed, and strips Pro settings for a free plan", () => {
    const next = applyTemplate(oneWay(["work"], ["personal"], "Desk"), "work_copy", byId(sources), true);
    expect(next.sync.name).toBe("Desk");
    expect(next.sync.sourceCalendarIds).toEqual(["work"]);
    expect(next.sync.markPrivate).toBe(false);
    expect(next.sync.shareAs).toBe("busy_only");
  });

  it("starts from scratch without losing the calendars", () => {
    const profiled = applyTemplate(oneWay(["work"], ["personal"]), "work_copy", byId(sources), false);
    const scratch = applyTemplate(profiled, null, byId(sources), false);
    expect(scratch.sync.template).toBeNull();
    expect(scratch.sync.name).toBe("");
    expect(scratch.sync.destinationCalendarIds).toEqual(["personal"]);
  });
});

describe("resolveAddToSyncTargets", () => {
  const sources = [
    makeSource("work", "google-account"),
    makeSource("personal", "google-account"),
    makeSource("family", "outlook-account"),
    makeSource("holidays", "ics-account", ["pull"]),
  ];

  it("offers the connected account's calendar to each sync it could join", () => {
    const sync = summary({ destinationCalendarIds: ["personal"], sourceCalendarIds: ["work"] });
    expect(resolveAddToSyncTargets([sync], sources, "outlook-account")).toEqual([{ calendar: sources[2], sync }]);
  });

  it("offers nothing for a calendar already in the sync, or one that can't take the role", () => {
    const both = summary({ id: "both", memberCalendarIds: ["work", "family"], mode: "both_ways" });
    const one = summary({ destinationCalendarIds: ["personal"], id: "one", sourceCalendarIds: ["work"] });
    expect(resolveAddToSyncTargets([both], sources, "outlook-account")).toEqual([{ calendar: null, sync: both }]);
    expect(resolveAddToSyncTargets([one], sources, "ics-account")).toEqual([{ calendar: null, sync: one }]);
  });

  it("lists the syncs alone when nothing was just connected", () => {
    const sync = summary({});
    expect(resolveAddToSyncTargets([sync], sources, null)).toEqual([{ calendar: null, sync }]);
  });
});

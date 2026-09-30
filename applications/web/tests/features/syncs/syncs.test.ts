import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SETTINGS } from "@keeper.sh/data-schemas";
import {
  PREVIEW_EVENTS,
  describeChange,
  describeConflicts,
  describeRun,
  findDraftConflicts,
  newestFirst,
  previewEventsFor,
  previewDirections,
  previewSync,
  roleIn,
  summarizeSync,
} from "../../../src/features/syncs/syncs";
import { formatSyncedAgo } from "../../../src/features/syncs/relative-time";

const names = new Map([
  ["work", { id: "work", name: "Work" }],
  ["school", { id: "school", name: "School" }],
  ["personal", { id: "personal", name: "Personal" }],
]);

const oneWay = { destinationCalendarIds: ["personal"], memberCalendarIds: [], mode: "one_way" as const, sourceCalendarIds: ["work", "school"] };
const [designReview, oneOnOne, offsite] = PREVIEW_EVENTS;

describe("summarizeSync", () => {
  it("reads a one-way and a both-ways sync as a short sentence", () => {
    expect(summarizeSync({ ...oneWay, shareAs: "busy_only" }, names)).toBe("Work, School → Personal · Busy Only");
    expect(summarizeSync({
      destinationCalendarIds: [],
      memberCalendarIds: ["work", "personal"],
      mode: "both_ways",
      shareAs: "title_only",
      sourceCalendarIds: [],
    }, names)).toBe("Work, Personal · Both Ways · Title Only");
  });

  it("names a calendar's part in a sync", () => {
    expect(roleIn(oneWay, "work")).toBe("Sends");
    expect(roleIn(oneWay, "personal")).toBe("Receives");
    expect(roleIn(oneWay, "family")).toBeNull();
  });
});

describe("previewSync", () => {
  it("shows the copy and what decided it", () => {
    if (!designReview || !oneOnOne || !offsite) throw new Error("preview events missing");
    expect(previewSync({ ...DEFAULT_SYNC_SETTINGS, skipTitleKeywords: ["roadmap", "review"] }, designReview, "Work").decidedBy)
      .toBe("Never Copy · Titles with “review”");
    expect(previewSync(DEFAULT_SYNC_SETTINGS, designReview, "Work")).toEqual({
      copy: { description: undefined, isPrivate: undefined, location: undefined, time: designReview.time, title: "Work" },
      decidedBy: "Share As · Busy Only",
      dropped: [designReview.location, designReview.description],
      followsShareAs: true,
    });
    expect(previewSync({ ...DEFAULT_SYNC_SETTINGS, skipAllDay: true }, offsite, "Work")).toEqual({
      copy: null,
      decidedBy: "Never Copy · All-day events",
      dropped: [],
      followsShareAs: false,
    });
    const rules = [{
      actions: [{ kind: "rename" as const, template: "Meeting" }],
      conditions: [{ kind: "title_contains" as const, value: "1:1" }],
      id: "rule-1",
      match: "any" as const,
      name: "1:1s stay vague",
    }];
    expect(previewSync({ ...DEFAULT_SYNC_SETTINGS, markPrivate: true, rules }, oneOnOne, "Work")).toMatchObject({
      copy: { isPrivate: true, title: "Meeting" },
      decidedBy: "Rule · 1:1s stay vague",
      followsShareAs: false,
    });
  });
});

describe("previewDirections", () => {
  it("lists each calendar that sends with everywhere it copies into", () => {
    expect(previewDirections(oneWay, names)).toEqual([
      { destinations: ["Personal"], key: "work", source: "Work" },
      { destinations: ["Personal"], key: "school", source: "School" },
    ]);
    const bothWays = { destinationCalendarIds: [], memberCalendarIds: ["work", "school", "personal"], mode: "both_ways" as const, sourceCalendarIds: [] };
    expect(previewDirections(bothWays, names).map(({ source, destinations }) => `${source} → ${destinations.join(", ")}`)).toEqual([
      "Work → School, Personal",
      "School → Work, Personal",
      "Personal → Work, School",
    ]);
  });

  it("falls back to placeholder names until both sides are picked", () => {
    expect(previewDirections({ ...oneWay, destinationCalendarIds: [] }, names)).toEqual([
      { destinations: ["the destination"], key: "work", source: "Work" },
    ]);
    expect(previewDirections({ destinationCalendarIds: [], memberCalendarIds: ["work"], mode: "both_ways", sourceCalendarIds: [] }, names)).toEqual([
      { destinations: ["the others"], key: "work", source: "Work" },
    ]);
  });
});

describe("previewEventsFor", () => {
  it("adds a sample for each title keyword and out-of-office condition the fixed samples miss", () => {
    const extras = previewEventsFor({ ...DEFAULT_SYNC_SETTINGS, skipOutOfOffice: true, skipTitleKeywords: ["standup", "standups", "lunch"] })
      .slice(PREVIEW_EVENTS.length)
      .map((event) => event.title);
    expect(extras).toEqual(["Out of Office", "Standups", "Lunch"]);
    expect(previewEventsFor(DEFAULT_SYNC_SETTINGS)).toEqual(PREVIEW_EVENTS);
  });
});

describe("conflicts", () => {
  it("finds pairs another sync already owns and explains them", () => {
    const others = [{ ...oneWay, id: "sync-1", name: "Work Blocks Personal" }];
    const draft = { destinationCalendarIds: [], memberCalendarIds: ["work", "personal"], mode: "both_ways" as const, sourceCalendarIds: [] };
    const conflicts = findDraftConflicts(draft, others);
    expect(conflicts).toEqual([{ destinationCalendarId: "personal", sourceCalendarId: "work", syncId: "sync-1", syncName: "Work Blocks Personal" }]);
    expect(describeConflicts(conflicts, names)).toBe(
      "Work → Personal is already in Work Blocks Personal. A calendar can only copy into another through one sync.",
    );
  });
});

describe("activity descriptions", () => {
  it("describes changes and runs in plain words", () => {
    expect(describeChange({ calendarId: "school", kind: "calendar_added", role: "source" }, names)).toBe("Added School as a source.");
    expect(describeChange({ from: "full", kind: "share_as_changed", to: "busy_only" }, names))
      .toBe("Share As changed from Full Details to Busy Only.");
    expect(describeRun({
      added: 3,
      copied: 10,
      destinationCalendarId: "personal",
      failed: 0,
      removed: 1,
      sharedDestination: false,
      skipped: 2,
      skippedBy: [{ count: 2, name: "All-day events", ruleId: "skip:all_day" }],
    }, names)).toBe("Synced to Personal. 3 new, 1 removed. Skipping 2 events, most by all-day events.");
  });

  it("formats how long ago a sync ran", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(formatSyncedAgo(null, now)).toBe("Not synced yet");
    expect(formatSyncedAgo("2026-09-27T11:58:00.000Z", now)).toBe("2m ago");
    expect(formatSyncedAgo("2026-09-27T09:00:00.000Z", now)).toBe("3h ago");
  });
});

describe("newestFirst", () => {
  it("orders syncs by creation, newest first, breaking ties by id", () => {
    const syncs = [
      { createdAt: "2026-09-01T00:00:00.000Z", id: "a" },
      { createdAt: "2026-09-03T00:00:00.000Z", id: "b" },
      { createdAt: "2026-09-03T00:00:00.000Z", id: "c" },
    ];
    expect(newestFirst(syncs).map((sync) => sync.id)).toEqual(["c", "b", "a"]);
    expect(syncs.map((sync) => sync.id)).toEqual(["a", "b", "c"]);
  });
});

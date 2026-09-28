import { describe, expect, it } from "vitest";
import { diffSyncChanges } from "@keeper.sh/data-schemas";
import {
  addConnectedCalendar,
  buildFirstConnectDraft,
  createSyncDraft,
  draftProblem,
  isRiskySave,
  pruneStaleIds,
  switchMode,
  toCreateBody,
  toggleCalendar,
} from "../../../src/features/syncs/sync-draft";
import { makeSource } from "../setup/fixtures";

const work = makeSource("work", "google", ["pull", "push"], { name: "Work" });
const personal = makeSource("personal", "icloud", ["pull", "push"], { name: "Personal" });
const family = makeSource("family", "icloud", ["pull", "push"], { name: "Family" });
const feed = makeSource("feed", "ics", ["pull"], { name: "Gym Classes" });
const calendarsById = new Map([work, personal, family, feed].map((calendar) => [calendar.id, calendar] as const));

describe("createSyncDraft", () => {
  it("fills in a profile's settings and name", () => {
    expect(createSyncDraft("block_my_time")).toMatchObject({
      mode: "both_ways",
      name: "Block My Time",
      shareAs: "busy_only",
      skipAllDay: true,
      skipFocusTime: true,
      template: "block_my_time",
    });
    expect(createSyncDraft("work_copy")).toMatchObject({ markPrivate: true, mode: "one_way", shareAs: "full" });
  });
});

describe("toggleCalendar", () => {
  it("moves a calendar off the other end of a one-way sync", () => {
    const draft = toggleCalendar(createSyncDraft(null, { destinationCalendarIds: ["work"] }), "source", "work");
    expect(draft).toMatchObject({ destinationCalendarIds: [], sourceCalendarIds: ["work"] });
    expect(toggleCalendar(draft, "source", "work").sourceCalendarIds).toEqual([]);
  });
});

describe("switchMode", () => {
  it("merges both ends into members, dropping calendars that can't send and receive", () => {
    const oneWay = createSyncDraft(null, { destinationCalendarIds: ["personal"], sourceCalendarIds: ["feed", "work"] });
    expect(switchMode(oneWay, "both_ways", calendarsById)).toEqual({
      destinationCalendarIds: [],
      memberCalendarIds: ["work", "personal"],
      mode: "both_ways",
      sourceCalendarIds: [],
    });
  });

  it("splits members into one source and the rest as destinations", () => {
    const bothWays = createSyncDraft(null, { memberCalendarIds: ["work", "personal", "family"], mode: "both_ways" });
    expect(switchMode(bothWays, "one_way", calendarsById)).toMatchObject({
      destinationCalendarIds: ["personal", "family"],
      sourceCalendarIds: ["work"],
    });
  });
});

describe("buildFirstConnectDraft", () => {
  it("picks one two-way calendar per account for Block My Time", () => {
    expect(buildFirstConnectDraft([work, personal, family, feed])).toMatchObject({
      memberCalendarIds: ["work", "personal"],
      template: "block_my_time",
    });
  });

  it("tops up from one account and gives up below two calendars", () => {
    expect(buildFirstConnectDraft([personal, family])?.memberCalendarIds).toEqual(["personal", "family"]);
    expect(buildFirstConnectDraft([work, feed])).toBeNull();
  });
});

describe("addConnectedCalendar", () => {
  it("fills the role the user left to connect an account", () => {
    const draft = createSyncDraft(null, { sourceCalendarIds: ["work"] });
    expect(addConnectedCalendar(draft, [work, personal], "icloud", "destination").destinationCalendarIds).toEqual(["personal"]);
  });

  it("falls back to the next empty end, skipping calendars that can't fill it", () => {
    const draft = createSyncDraft();
    expect(addConnectedCalendar(draft, [feed], "ics", null).sourceCalendarIds).toEqual(["feed"]);
    const withSource = createSyncDraft(null, { sourceCalendarIds: ["work"] });
    expect(addConnectedCalendar(withSource, [feed], "ics", null)).toBe(withSource);
  });
});

describe("pruneStaleIds", () => {
  it("drops calendars that no longer exist and keeps the draft otherwise", () => {
    const draft = createSyncDraft(null, { destinationCalendarIds: ["gone"], sourceCalendarIds: ["work"] });
    expect(pruneStaleIds(draft, [work]).destinationCalendarIds).toEqual([]);
    const clean = createSyncDraft(null, { sourceCalendarIds: ["work"] });
    expect(pruneStaleIds(clean, [work])).toBe(clean);
  });
});

describe("draft checks", () => {
  it("explains what's missing and builds a create body with a fallback name", () => {
    expect(draftProblem(createSyncDraft())).toBe("Pick calendars to copy from and to.");
    const draft = createSyncDraft(null, { destinationCalendarIds: ["personal"], sourceCalendarIds: ["work"] });
    expect(draftProblem(draft)).toBeNull();
    expect(toCreateBody(draft, "Work → Personal")).toMatchObject({ mode: "one_way", name: "Work → Personal" });
  });

  it("holds back a rule that's missing a condition or an action", () => {
    const rule = { actions: [{ kind: "skip" as const }], conditions: [{ kind: "all_day" as const }], id: "r1", match: "all" as const, name: "Lunches" };
    const draft = createSyncDraft(null, { destinationCalendarIds: ["personal"], sourceCalendarIds: ["work"] });
    expect(draftProblem({ ...draft, rules: [rule] })).toBeNull();
    expect(draftProblem({ ...draft, rules: [{ ...rule, conditions: [] }] })).toBe("Lunches needs a condition.");
    expect(draftProblem({ ...draft, rules: [{ ...rule, actions: [] }] })).toBe("Lunches needs an action.");
  });
});

describe("isRiskySave", () => {
  const saved = createSyncDraft(null, { destinationCalendarIds: ["personal", "family"], sourceCalendarIds: ["work"] });
  const risky = (edits: Parameters<typeof createSyncDraft>[1]) => isRiskySave(diffSyncChanges(saved, { ...saved, ...edits }));

  it("asks before dropping a calendar or flipping direction", () => {
    expect(risky({ destinationCalendarIds: ["personal"] })).toBe(true);
    expect(risky(switchMode(saved, "both_ways", calendarsById))).toBe(true);
  });

  it("saves additions and setting changes without asking", () => {
    expect(risky({ destinationCalendarIds: ["personal", "family", "feed"] })).toBe(false);
    expect(risky({ shareAs: "full" })).toBe(false);
  });

  it("finds nothing to save once an edit is put back", () => {
    const edits = [{ skipAllDay: !saved.skipAllDay }, { skipAllDay: saved.skipAllDay }].reduce((current, patch) => ({ ...current, ...patch }), {});
    expect(diffSyncChanges(saved, { ...saved, ...edits })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SETTINGS, diffSyncChanges } from "@keeper.sh/data-schemas";
import {
  addCalendarToSync,
  addConnectedCalendar,
  buildFirstConnectDraft,
  createSyncDraft,
  describeRemovals,
  draftProblem,
  isRiskySave,
  pruneStaleEdits,
  pruneStaleIds,
  readNewSyncSearch,
  roleCapacity,
  saveRemovals,
  settleEdits,
  switchMode,
  syncNameProblem,
  toCreateBody,
  toPatchBody,
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

  it("leaves Pro settings out for a locked viewer but keeps the profile's shape", () => {
    const locked = createSyncDraft("block_my_time", { memberCalendarIds: ["work", "personal"] }, { locked: true });
    expect(locked).toMatchObject({
      ...DEFAULT_SYNC_SETTINGS,
      memberCalendarIds: ["work", "personal"],
      mode: "both_ways",
      name: "Block My Time",
      template: "block_my_time",
    });
  });
});

describe("readNewSyncSearch", () => {
  it("ignores profiles that are really Object.prototype keys", () => {
    for (const profile of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(readNewSyncSearch({ profile }).profile).toBeUndefined();
    }
    expect(readNewSyncSearch({ profile: "work_copy" }).profile).toBe("work_copy");
  });
});

describe("toggleCalendar", () => {
  it("moves a calendar off the other end of a one-way sync", () => {
    const draft = toggleCalendar(createSyncDraft(null, { destinationCalendarIds: ["work"] }), "source", "work");
    expect(draft).toMatchObject({ destinationCalendarIds: [], sourceCalendarIds: ["work"] });
    expect(toggleCalendar(draft, "source", "work").sourceCalendarIds).toEqual([]);
  });

  it("hands back only the calendar fields, so a pick can't carry a stale name or pause", () => {
    const draft = createSyncDraft(null, { name: "Old name", paused: false, sourceCalendarIds: ["work"] });
    expect(Object.keys(toggleCalendar(draft, "destination", "personal")).sort()).toEqual(
      ["destinationCalendarIds", "memberCalendarIds", "mode", "sourceCalendarIds"],
    );
  });
});

describe("addCalendarToSync", () => {
  it("adds a new calendar where it can receive copies", () => {
    expect(addCalendarToSync(createSyncDraft(null, { sourceCalendarIds: ["work"] }), personal)?.destinationCalendarIds).toEqual(["personal"]);
    expect(addCalendarToSync(createSyncDraft(null, { memberCalendarIds: ["work"], mode: "both_ways" }), family)?.memberCalendarIds)
      .toEqual(["work", "family"]);
  });

  it("does nothing for a calendar already in the sync, one that can't take the role, or one that's gone", () => {
    expect(addCalendarToSync(createSyncDraft(null, { sourceCalendarIds: ["work"] }), work)).toBeNull();
    expect(addCalendarToSync(createSyncDraft(null, { sourceCalendarIds: ["work"] }), feed)).toBeNull();
    expect(addCalendarToSync(createSyncDraft(null, { memberCalendarIds: ["work"], mode: "both_ways" }), feed)).toBeNull();
    expect(addCalendarToSync(createSyncDraft(), undefined)).toBeNull();
  });
});

describe("roleCapacity", () => {
  it("caps each end at the plan limit, but lets a saved list keep its length", () => {
    const saved = createSyncDraft(null, { destinationCalendarIds: ["a", "b", "c", "d", "e"], sourceCalendarIds: ["work"] });
    expect(roleCapacity("destination", "one_way", null, 3)).toBe(3);
    expect(roleCapacity("destination", "one_way", saved, 3)).toBe(5);
    expect(roleCapacity("member", "both_ways", saved, 3)).toBe(3);
    expect(roleCapacity("member", "both_ways", null, null)).toBe(8);
    expect(roleCapacity("source", "one_way", null, null)).toBe(50);
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

  it("starts a free plan on busy time with nothing skipped, which the server accepts without Pro", () => {
    expect(buildFirstConnectDraft([work, personal], false)).toMatchObject({
      memberCalendarIds: ["work", "personal"],
      mode: "both_ways",
      name: "",
      shareAs: "busy_only",
      skipAllDay: false,
      skipFocusTime: false,
      template: null,
    });
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

describe("pruneStaleEdits", () => {
  it("drops vanished calendars only from the lists the user edited", () => {
    const edits = { destinationCalendarIds: ["personal", "gone"], shareAs: "full" as const };
    expect(pruneStaleEdits(edits, [work, personal])).toEqual({ destinationCalendarIds: ["personal"], shareAs: "full" });
    const clean = { sourceCalendarIds: ["work"] };
    expect(pruneStaleEdits(clean, [work])).toBe(clean);
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

describe("draft limits", () => {
  const valid = createSyncDraft(null, { destinationCalendarIds: ["personal"], sourceCalendarIds: ["work"] });
  const rule = { actions: [{ kind: "skip" as const }], conditions: [{ kind: "title_contains" as const, value: "Lunch" }], id: "r1", match: "any" as const, name: "Lunches" };

  it("names the limit a draft runs into instead of leaving it to the server", () => {
    expect(draftProblem({ ...valid, skipTitleKeywords: ["x".repeat(101)] })).toBe("Title words to skip can be up to 100 characters.");
    expect(draftProblem({ ...valid, busyTitle: "x".repeat(201) })).toBe("Busy titles can be up to 200 characters.");
    expect(draftProblem({ ...valid, rules: [{ ...rule, name: "x".repeat(81) }] })).toBe("Rule names can be up to 80 characters.");
    expect(draftProblem({ ...valid, rules: [{ ...rule, conditions: Array.from({ length: 11 }, () => rule.conditions[0]) }] }))
      .toBe("Lunches can have up to 10 conditions.");
    expect(draftProblem({ ...valid, rules: [{ ...rule, conditions: [{ kind: "title_contains", value: "x".repeat(61) }] }] }))
      .toBe("In Lunches, Title Contains can be up to 60 characters.");
    expect(draftProblem({ ...valid, rules: [{ ...rule, actions: [{ kind: "rename", template: "x".repeat(201) }] }] }))
      .toBe("In Lunches, Rename To can be up to 200 characters.");
  });

  it("holds a free plan to its calendar limit, except for lists the saved sync already had", () => {
    const wide = { ...valid, destinationCalendarIds: ["personal", "family", "a", "b"] };
    expect(draftProblem(wide, { calendarLimit: 3 })).toBe("Free plans copy from up to 3 calendars into up to 3.");
    expect(draftProblem(wide, { calendarLimit: 3, saved: wide })).toBeNull();
    expect(draftProblem(wide)).toBeNull();
  });

  it("gives a long sync name its real reason", () => {
    expect(syncNameProblem("x".repeat(81))).toBe("Sync names can be up to 80 characters.");
    expect(syncNameProblem("Work")).toBeNull();
  });
});

describe("isRiskySave", () => {
  const saved = createSyncDraft(null, { destinationCalendarIds: ["personal", "family"], sourceCalendarIds: ["work"] });
  const risky = (edits: Parameters<typeof createSyncDraft>[1]) => isRiskySave(saved, { ...saved, ...edits });

  it("asks before anything that deletes copies", () => {
    expect(risky({ destinationCalendarIds: ["personal"] })).toBe(true);
    expect(risky({ skipAllDay: true })).toBe(true);
    expect(risky({ skipTitleKeywords: ["Dentist"] })).toBe(true);
    expect(risky({ rules: [{ actions: [{ kind: "skip" }], conditions: [{ kind: "timed" }], id: "r1", match: "all", name: "Timed" }] })).toBe(true);
  });

  it("saves additions and setting changes that keep every copy without asking", () => {
    expect(risky({ destinationCalendarIds: ["personal", "family", "feed"] })).toBe(false);
    expect(risky({ shareAs: "full" })).toBe(false);
    expect(risky(switchMode(saved, "both_ways", calendarsById))).toBe(false);
  });

  it("names the copies a both-ways to one-way switch deletes, though no calendar leaves", () => {
    const bothWays = createSyncDraft(null, { memberCalendarIds: ["work", "personal", "family"], mode: "both_ways" });
    const next = { ...bothWays, ...switchMode(bothWays, "one_way", calendarsById) };
    expect(describeRemovals(saveRemovals(bothWays, next), calendarsById)).toEqual([
      "Copies of Personal and Family are removed from Work.",
      "Copies of Personal are removed from Family.",
      "Copies of Family are removed from Personal.",
    ]);
  });

  it("says which skips remove copies", () => {
    expect(describeRemovals(saveRemovals(saved, { ...saved, skipFocusTime: true, skipTitleKeywords: ["Dentist"] }), calendarsById)).toEqual([
      "Copies of focus time are removed.",
      "Copies of events titled “Dentist” are removed.",
    ]);
  });

  it("finds nothing to save once an edit is put back", () => {
    const edits = [{ skipAllDay: !saved.skipAllDay }, { skipAllDay: saved.skipAllDay }].reduce((current, patch) => ({ ...current, ...patch }), {});
    expect(diffSyncChanges(saved, { ...saved, ...edits })).toEqual([]);
  });
});

describe("toPatchBody", () => {
  const saved = { ...createSyncDraft(null, { destinationCalendarIds: ["personal"], name: "Work out", sourceCalendarIds: ["work"] }), updatedAt: "2026-10-01T10:00:00.000Z" };

  it("sends only what differs from the saved copy, never the name or pause, and says which copy it started from", () => {
    const draft = { ...saved, destinationCalendarIds: ["personal", "family"], name: "Stale", paused: true };
    expect(toPatchBody(saved, draft)).toEqual({ destinationCalendarIds: ["personal", "family"], expectedUpdatedAt: saved.updatedAt });
  });

  it("treats rules with their keys in another order as unchanged", () => {
    const rule = { actions: [{ kind: "skip" as const }], conditions: [{ kind: "all_day" as const }], id: "r1", match: "all" as const, name: "Days" };
    const reordered = { name: rule.name, match: rule.match, id: rule.id, conditions: rule.conditions, actions: rule.actions };
    expect(toPatchBody({ ...saved, rules: [rule] }, { ...saved, rules: [reordered] })).toEqual({ expectedUpdatedAt: saved.updatedAt });
  });
});

describe("settleEdits", () => {
  it("keeps an edit made while the save was out", () => {
    const sent = { ...createSyncDraft(), destinationCalendarIds: ["personal"], skipAllDay: false };
    const edits = { destinationCalendarIds: ["personal"], skipAllDay: true };
    expect(settleEdits(edits, sent)).toEqual({ skipAllDay: true });
  });
});

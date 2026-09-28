import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_SETTINGS,
  compileSyncRules,
  createSyncBodySchema,
  deriveSyncPairs,
  diffSyncChanges,
  evaluateRules,
  normalizeSkipKeywords,
  patchSyncBodySchema,
  resolveSyncState,
  validateSyncCalendars,
  type RuleEventFacts,
  type SyncCalendars,
  type SyncDefinition,
  type SyncSettings,
} from "../src/index";

const facts = (overrides: Partial<RuleEventFacts> = {}): RuleEventFacts => ({
  calendarName: "Work",
  description: "Agenda",
  isAllDay: false,
  isFocusTime: false,
  isOutOfOffice: false,
  location: "Room 4",
  title: "Design Review",
  ...overrides,
});

const settings = (overrides: Partial<SyncSettings> = {}): SyncSettings => ({ ...DEFAULT_SYNC_SETTINGS, ...overrides });

const oneWay = (sourceCalendarIds: string[], destinationCalendarIds: string[]): SyncCalendars => ({
  destinationCalendarIds,
  memberCalendarIds: [],
  mode: "one_way",
  sourceCalendarIds,
});

const bothWays = (memberCalendarIds: string[]): SyncCalendars => ({
  destinationCalendarIds: [],
  memberCalendarIds,
  mode: "both_ways",
  sourceCalendarIds: [],
});

const definition = (overrides: Partial<SyncDefinition> = {}): SyncDefinition => ({
  ...DEFAULT_SYNC_SETTINGS,
  ...oneWay(["work"], ["personal"]),
  name: "Work Blocks Personal",
  paused: false,
  ...overrides,
});

const oneOnOnes = {
  actions: [{ kind: "rename" as const, template: "Meeting" }],
  conditions: [{ kind: "title_contains" as const, value: "1:1" }],
  id: "rule-1",
  match: "any" as const,
  name: "1:1s stay vague",
};

describe("sync bodies", () => {
  it("accepts a minimal create body and rejects unknown keys", () => {
    expect(createSyncBodySchema.allows({ mode: "both_ways", memberCalendarIds: ["a", "b"], name: "Block" })).toBe(true);
    expect(createSyncBodySchema.allows({ mode: "both_ways", name: "  " })).toBe(false);
    expect(createSyncBodySchema.allows({ mode: "sideways", name: "Block" })).toBe(false);
    expect(patchSyncBodySchema.allows({ shareAs: "title_only" })).toBe(true);
    expect(patchSyncBodySchema.allows({ ruleIds: [] })).toBe(false);
  });

  it("requires advanced rules to carry at least one condition and action", () => {
    expect(patchSyncBodySchema.allows({ rules: [oneOnOnes] })).toBe(true);
    expect(patchSyncBodySchema.allows({ rules: [{ ...oneOnOnes, conditions: [] }] })).toBe(false);
    expect(patchSyncBodySchema.allows({ rules: [{ ...oneOnOnes, actions: [] }] })).toBe(false);
  });
});

describe("validateSyncCalendars", () => {
  it("needs both ends of a one-way sync, without overlap", () => {
    expect(validateSyncCalendars(oneWay(["a"], ["b"]))).toBeNull();
    expect(validateSyncCalendars(oneWay([], ["b"]))).toBe("Pick calendars to copy from and to.");
    expect(validateSyncCalendars(oneWay(["a"], ["a", "b"]))).toMatch(/itself/);
    expect(validateSyncCalendars(oneWay(["a", "a"], ["b"]))).toMatch(/once/);
  });

  it("needs two to eight members in a both-ways sync", () => {
    expect(validateSyncCalendars(bothWays(["a"]))).toMatch(/two/);
    expect(validateSyncCalendars(bothWays(["a", "b"]))).toBeNull();
    expect(validateSyncCalendars(bothWays(["a", "b", "c", "d", "e", "f", "g", "h", "i"]))).toMatch(/up to 8/);
  });
});

describe("deriveSyncPairs", () => {
  it("crosses sources with destinations", () => {
    expect(deriveSyncPairs(oneWay(["work", "school"], ["personal"]))).toEqual([
      { destinationCalendarId: "personal", sourceCalendarId: "work" },
      { destinationCalendarId: "personal", sourceCalendarId: "school" },
    ]);
  });

  it("links every ordered pair of both-ways members, never a calendar to itself", () => {
    const pairs = deriveSyncPairs(bothWays(["a", "b", "c"]));
    expect(pairs).toHaveLength(6);
    expect(pairs.some((pair) => pair.sourceCalendarId === pair.destinationCalendarId)).toBe(false);
  });
});

describe("compileSyncRules", () => {
  it("shares busy-only by default, named after the calendar", () => {
    expect(evaluateRules(compileSyncRules(settings()), facts())).toEqual({ skip: false, summary: "Work" });
  });

  it("uses a custom busy title and keeps details for fuller share modes", () => {
    expect(evaluateRules(compileSyncRules(settings({ busyTitle: "Taken" })), facts())).toEqual({ skip: false, summary: "Taken" });
    expect(evaluateRules(compileSyncRules(settings({ shareAs: "title_only" })), facts())).toEqual({ skip: false, summary: "Design Review" });
    expect(evaluateRules(compileSyncRules(settings({ shareAs: "full" })), facts())).toMatchObject({
      description: "Agenda",
      location: "Room 4",
    });
  });

  it("lets Never Copy win over an advanced rule that would copy", () => {
    const compiled = compileSyncRules(settings({
      rules: [{ ...oneOnOnes, conditions: [{ kind: "all_day" }] }],
      skipAllDay: true,
    }));
    expect(evaluateRules(compiled, facts({ isAllDay: true }))).toEqual({ skip: true });
  });

  it("skips titles containing any keyword, case-insensitively", () => {
    const compiled = compileSyncRules(settings({ skipTitleKeywords: ["standup", "LUNCH"] }));
    expect(evaluateRules(compiled, facts({ title: "Team Lunch" }))).toEqual({ skip: true });
    expect(evaluateRules(compiled, facts())).toMatchObject({ skip: false });
  });

  it("puts advanced rules ahead of Share As and keeps Share As last", () => {
    const compiled = compileSyncRules(settings({ rules: [oneOnOnes], shareAs: "full" }));
    expect(compiled.at(-1)?.id).toBe("share");
    expect(evaluateRules(compiled, facts({ title: "1:1 with Priya" }))).toMatchObject({ summary: "Meeting" });
  });

  it("leaves out advanced rules that are still missing a condition or an action", () => {
    const compiled = compileSyncRules(settings({ rules: [{ ...oneOnOnes, actions: [] }, { ...oneOnOnes, conditions: [] }] }));
    expect(compiled.map((rule) => rule.id)).toEqual(["share"]);
  });

  it("marks every copy private, including ones an advanced rule reshapes", () => {
    const compiled = compileSyncRules(settings({ markPrivate: true, rules: [oneOnOnes] }));
    expect(evaluateRules(compiled, facts({ title: "1:1 with Priya" }))).toMatchObject({ isPrivate: true });
    expect(evaluateRules(compiled, facts())).toMatchObject({ isPrivate: true });
  });
});

describe("normalizeSkipKeywords", () => {
  it("trims and drops blanks and case-insensitive duplicates", () => {
    expect(normalizeSkipKeywords([" standup ", "Standup", "", "lunch"])).toEqual(["standup", "lunch"]);
  });
});

describe("diffSyncChanges", () => {
  it("reports creation", () => {
    expect(diffSyncChanges(null, definition())).toEqual([{ kind: "created" }]);
  });

  it("reports each user-visible change", () => {
    const before = definition({ skipTitleKeywords: ["lunch"] });
    const after = definition({
      ...oneWay(["work", "school"], ["personal"]),
      markPrivate: true,
      name: "Work and School",
      paused: true,
      shareAs: "title_only",
      skipAllDay: true,
      skipTitleKeywords: ["standup"],
    });
    expect(diffSyncChanges(before, after)).toEqual([
      { from: "Work Blocks Personal", kind: "renamed", to: "Work and School" },
      { calendarId: "school", kind: "calendar_added", role: "source" },
      { from: "busy_only", kind: "share_as_changed", to: "title_only" },
      { kind: "private_changed", to: true },
      { kind: "skip_changed", skip: "all_day", to: true },
      { keyword: "standup", kind: "keyword_added" },
      { keyword: "lunch", kind: "keyword_removed" },
      { kind: "paused" },
    ]);
  });

  it("reports a mode switch once instead of every calendar", () => {
    expect(diffSyncChanges(definition(), definition(bothWays(["work", "personal"])))).toEqual([
      { kind: "mode_changed", to: "both_ways" },
    ]);
  });
});

describe("resolveSyncState", () => {
  it("prefers paused, then empty, then problem", () => {
    expect(resolveSyncState({ hasProblem: true, pairCount: 0, paused: true })).toBe("paused");
    expect(resolveSyncState({ hasProblem: true, pairCount: 0, paused: false })).toBe("empty");
    expect(resolveSyncState({ hasProblem: true, pairCount: 2, paused: false })).toBe("problem");
    expect(resolveSyncState({ hasProblem: false, pairCount: 2, paused: false })).toBe("ok");
  });
});

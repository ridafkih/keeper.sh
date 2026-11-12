import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_SETTINGS,
  MAX_ADVANCED_RULES,
  MAX_SKIP_KEYWORDS,
  MAX_SYNC_CALENDARS,
  addsProSettings,
  compileSyncRules,
  createSyncBodySchema,
  deriveSyncPairs,
  diffSyncChanges,
  evaluateRules,
  normalizeAdvancedRules,
  normalizeSkipKeywords,
  patchSyncBodySchema,
  resolveSyncState,
  validateSyncCalendarLimit,
  validateSyncCalendars,
  withoutProSettings,
  type RuleEventFacts,
  type SyncCalendars,
  type SyncDefinition,
  type SyncSettings,
} from "../src/index";

const facts = (overrides: Partial<RuleEventFacts> = {}): RuleEventFacts => ({
  availability: "busy",
  calendarName: "Work",
  description: "Agenda",
  isAllDay: false,
  isFocusTime: false,
  isOutOfOffice: false,
  isTentative: false,
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

  it("starts each advanced rule from Share As, so a rename keeps hidden details hidden", () => {
    const busyOnly = compileSyncRules(settings({ rules: [oneOnOnes], shareAs: "busy_only" }));
    expect(evaluateRules(busyOnly, facts({ title: "1:1 with Priya" }))).toEqual({ skip: false, summary: "Meeting" });

    const titleOnly = compileSyncRules(settings({ rules: [oneOnOnes], shareAs: "title_only" }));
    expect(evaluateRules(titleOnly, facts({ title: "1:1 with Priya" }))).toEqual({ skip: false, summary: "Meeting" });
  });

  it("keeps Share As's busy title for a rule that only hides more", () => {
    const hideLocation = { ...oneOnOnes, actions: [{ kind: "drop_location" as const }] };
    const busyOnly = compileSyncRules(settings({ busyTitle: "Taken", rules: [hideLocation], shareAs: "busy_only" }));
    expect(evaluateRules(busyOnly, facts({ title: "1:1 with Priya" }))).toEqual({ skip: false, summary: "Taken" });

    const full = compileSyncRules(settings({ rules: [hideLocation], shareAs: "full" }));
    expect(evaluateRules(full, facts({ title: "1:1 with Priya" }))).toEqual({ description: "Agenda", skip: false, summary: "1:1 with Priya" });
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

const limitBody = (overrides: Record<string, unknown>) => ({ mode: "one_way", name: "Work", ...overrides });
const calendarIdsOf = (count: number) => Array.from({ length: count }, (_value, index) => `calendar-${index}`);
const keywordsOf = (count: number) => Array.from({ length: count }, (_value, index) => `word ${index}`);

describe("body limits", () => {
  const body = limitBody;
  const rule = (value: string) => {
    const { id: _id, ...unsaved } = oneOnOnes;
    return { ...unsaved, conditions: [{ kind: "title_contains", value }] };
  };

  it("accepts each list at its limit and rejects one more", () => {
    expect(createSyncBodySchema.allows(body({ sourceCalendarIds: calendarIdsOf(MAX_SYNC_CALENDARS) }))).toBe(true);
    expect(createSyncBodySchema.allows(body({ sourceCalendarIds: calendarIdsOf(MAX_SYNC_CALENDARS + 1) }))).toBe(false);
    expect(createSyncBodySchema.allows(body({ skipTitleKeywords: keywordsOf(MAX_SKIP_KEYWORDS) }))).toBe(true);
    expect(createSyncBodySchema.allows(body({ skipTitleKeywords: keywordsOf(MAX_SKIP_KEYWORDS + 1) }))).toBe(false);
    const rules = (count: number) => Array.from({ length: count }, () => rule("1:1"));
    expect(createSyncBodySchema.allows(body({ rules: rules(MAX_ADVANCED_RULES) }))).toBe(true);
    expect(createSyncBodySchema.allows(body({ rules: rules(MAX_ADVANCED_RULES + 1) }))).toBe(false);
  });

  it("caps and requires a real title_contains value", () => {
    expect(createSyncBodySchema.allows(body({ rules: [rule("a".repeat(60))] }))).toBe(true);
    expect(createSyncBodySchema.allows(body({ rules: [rule("a".repeat(61))] }))).toBe(false);
    expect(createSyncBodySchema.allows(body({ rules: [rule("   ")] }))).toBe(false);
  });

  it("caps rule ids and the expected update time", () => {
    expect(createSyncBodySchema.allows(body({ rules: [{ ...oneOnOnes, id: "x".repeat(65) }] }))).toBe(false);
    expect(patchSyncBodySchema.allows({ expectedUpdatedAt: "2026-10-10T12:00:00.000Z" })).toBe(true);
    expect(createSyncBodySchema.allows(body({ expectedUpdatedAt: "2026-10-10T12:00:00.000Z" }))).toBe(false);
  });
});

describe("normalizeAdvancedRules", () => {
  const uuid = "0b4c2d6e-8f10-4a22-9b34-c5d6e7f8a9b0";
  let next = 0;
  const createId = () => `fresh-${next++}`;

  it("keeps an unused uuid and replaces missing, reserved, malformed and repeated ids", () => {
    next = 0;
    const rules = normalizeAdvancedRules([
      { ...oneOnOnes, id: uuid },
      { ...oneOnOnes, id: uuid },
      { ...oneOnOnes, id: "share" },
      { ...oneOnOnes, id: "skip:all_day" },
      { actions: oneOnOnes.actions, conditions: oneOnOnes.conditions, match: oneOnOnes.match, name: oneOnOnes.name },
    ], createId);
    expect(rules.map((rule) => rule.id)).toEqual([uuid, "fresh-0", "fresh-1", "fresh-2", "fresh-3"]);
  });

  it("trims names and condition values", () => {
    const [rule] = normalizeAdvancedRules([
      { ...oneOnOnes, conditions: [{ kind: "title_contains", value: "  1:1 " }], name: " Vague " },
    ], createId);
    expect(rule?.name).toBe("Vague");
    expect(rule?.conditions).toEqual([{ kind: "title_contains", value: "1:1" }]);
  });
});

describe("Busy Only and the event's own title", () => {
  it("drops {{event_name}} from a rule's rename and from the busy title", () => {
    const rules = compileSyncRules(settings({
      busyTitle: "{{event_name}}",
      rules: [{ ...oneOnOnes, actions: [{ kind: "rename", template: "{{event_name}} (away)" }] }],
    }));
    expect(evaluateRules(rules, facts({ title: "1:1 with Priya" }))).toEqual({ skip: false, summary: "(away)" });
    expect(evaluateRules(rules, facts())).toEqual({ skip: false, summary: "Work" });
  });

  it("keeps {{event_name}} when Share As already shares titles", () => {
    const rules = compileSyncRules(settings({
      rules: [{ ...oneOnOnes, actions: [{ kind: "rename", template: "{{event_name}} (away)" }] }],
      shareAs: "title_only",
    }));
    expect(evaluateRules(rules, facts({ title: "1:1 with Priya" }))).toEqual({ skip: false, summary: "1:1 with Priya (away)" });
  });

  it("orders the toggles, then keywords, then rules, then Share As", () => {
    const rules = compileSyncRules(settings({
      rules: [oneOnOnes],
      skipAllDay: true,
      skipFocusTime: true,
      skipOutOfOffice: true,
      skipTitleKeywords: ["Lunch"],
    }));
    expect(rules.map((rule) => rule.id)).toEqual([
      "skip:all_day",
      "skip:focus_time",
      "skip:out_of_office",
      "skip:keywords",
      "rule-1",
      "share",
    ]);
  });
});

describe("plan limits", () => {
  it("lets free plans keep or take away Pro settings a sync has, but not add any", () => {
    const pro = settings({ rules: [oneOnOnes], skipAllDay: true, skipFocusTime: true, skipTitleKeywords: ["Lunch"] });
    expect(addsProSettings(null, settings())).toBe(false);
    expect(addsProSettings(null, settings({ skipAllDay: true }))).toBe(true);
    expect(addsProSettings(pro, pro)).toBe(false);
    expect(addsProSettings(pro, { ...pro, rules: [], skipAllDay: false })).toBe(false);
    expect(addsProSettings(pro, { ...pro, skipOutOfOffice: true })).toBe(true);
    expect(addsProSettings(pro, { ...pro, skipTitleKeywords: ["Lunch", "Gym"] })).toBe(true);
    expect(addsProSettings(pro, { ...pro, rules: [{ ...oneOnOnes, name: "Changed" }] })).toBe(true);
    expect(addsProSettings(pro, { ...pro, rules: [structuredClone(oneOnOnes)] })).toBe(false);
  });

  it("resets every Pro setting for a free draft", () => {
    const free = withoutProSettings({ ...definition(), markPrivate: true, rules: [oneOnOnes], shareAs: "full", skipAllDay: true });
    expect(addsProSettings(null, free)).toBe(false);
    expect(free.name).toBe("Work Blocks Personal");
  });

  it("caps each calendar list, keeping lists that were already longer", () => {
    expect(validateSyncCalendarLimit(oneWay(["a", "b", "c"], ["d", "e", "f"]), null, 3)).toBeNull();
    expect(validateSyncCalendarLimit(oneWay(["a", "b", "c", "x"], ["d"]), null, 3)).toMatch(/up to 3/);
    expect(validateSyncCalendarLimit(bothWays(["a", "b", "c", "d"]), null, 3)).toMatch(/both ways/);
    const migrated = oneWay(["a", "b", "c", "x"], ["d"]);
    expect(validateSyncCalendarLimit(oneWay(["a", "b", "c", "y"], ["d"]), migrated, 3)).toBeNull();
    expect(validateSyncCalendarLimit(oneWay(["a", "b", "c", "x", "y"], ["d"]), migrated, 3)).toMatch(/up to 3/);
    expect(validateSyncCalendarLimit(bothWays(["a", "b", "c", "x"]), migrated, 3)).toMatch(/both ways/);
    expect(validateSyncCalendarLimit(oneWay(calendarIdsOf(50), ["d"]), null, Infinity)).toBeNull();
  });
});

describe("diffSyncChanges details", () => {
  it("reports a keyword whose case changed and ignores rule key order", () => {
    const before = definition({ rules: [oneOnOnes], skipTitleKeywords: ["lunch"] });
    const reordered = { name: oneOnOnes.name, match: oneOnOnes.match, id: oneOnOnes.id, conditions: oneOnOnes.conditions, actions: oneOnOnes.actions };
    expect(diffSyncChanges(before, { ...before, rules: [reordered], skipTitleKeywords: ["Lunch"] })).toEqual([
      { keyword: "Lunch", kind: "keyword_added" },
      { keyword: "lunch", kind: "keyword_removed" },
    ]);
  });
});

describe("status skips", () => {
  const skipping = (skipAvailabilities: SyncSettings["skipAvailabilities"]) => compileSyncRules(settings({ skipAvailabilities }));

  it("skips free events, tentative ones included", () => {
    const rules = skipping(["free"]);
    expect(evaluateRules(rules, facts({ availability: "free" }))).toEqual({ skip: true });
    expect(evaluateRules(rules, facts({ availability: "free", isTentative: true }))).toEqual({ skip: true });
    expect(evaluateRules(rules, facts())).toEqual({ skip: false, summary: "Work" });
  });

  it("treats a tentative event as Tentative rather than Busy", () => {
    expect(evaluateRules(skipping(["busy"]), facts({ isTentative: true }))).toEqual({ skip: false, summary: "Work" });
    expect(evaluateRules(skipping(["busy"]), facts())).toEqual({ skip: true });
    expect(evaluateRules(skipping(["tentative"]), facts({ isTentative: true }))).toEqual({ skip: true });
  });

  it("is a Pro setting that free plans may keep or remove", () => {
    const pro = settings({ skipAvailabilities: ["free", "tentative"] });
    expect(addsProSettings(null, pro)).toBe(true);
    expect(addsProSettings(pro, { ...pro, skipAvailabilities: ["free"] })).toBe(false);
    expect(withoutProSettings(pro).skipAvailabilities).toEqual([]);
  });

  it("reports each status turned on or off", () => {
    const before = definition({ skipAvailabilities: ["free"] });
    expect(diffSyncChanges(before, { ...before, skipAvailabilities: ["tentative"] })).toEqual([
      { kind: "status_skip_changed", status: "free", to: false },
      { kind: "status_skip_changed", status: "tentative", to: true },
    ]);
  });
});

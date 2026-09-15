import { describe, expect, it } from "vitest";
import type { CalendarDetail } from "../../../src/types/api";
import {
  availableActionKinds,
  availableConditionKinds,
  buildPairGroups,
  countPairs,
  findPair,
  moveItem,
  normalizeActions,
  removeAt,
  replaceAt,
  resolveAppliedRules,
  resolveDefaultRule,
  resolveUnappliedRules,
  splitPairsByAssignment,
  summarizeRule,
} from "../../../src/features/rules/rules";
import { makeSource } from "../setup/fixtures";

const detail = (id: string, destinationIds: string[]): CalendarDetail => ({
  calendarType: "oauth",
  calendarUrl: null,
  capabilities: ["pull", "push"],
  createdAt: "2026-01-01T00:00:00.000Z",
  customEventName: "{{calendar_name}}",
  destinationIds,
  disabled: false,
  excludeAllDayEvents: false,
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  id,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  markEventsAsPrivate: false,
  name: id,
  originalName: null,
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  sourceIds: [],
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  treatFullDayTimedEventsAsAllDay: false,
  unavailableSince: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: null,
});

const rule = (id: string, isDefault = false) => ({
  actions: [],
  conditions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isDefault,
  name: id,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("summarizeRule", () => {
  it("reads conditions then actions as one line", () => {
    expect(summarizeRule({
      actions: [{ kind: "rename", template: "OOO" }, { kind: "drop_description" }],
      conditions: [{ kind: "title_contains", value: "Standup" }],
    })).toBe('Title contains "Standup" · renamed "OOO", no description');
    expect(summarizeRule({ actions: [{ kind: "skip" }], conditions: [{ kind: "all_day" }, { kind: "focus_time" }] }))
      .toBe("All-day, focus time · not copied");
    expect(summarizeRule({ actions: [], conditions: [] })).toBe("Every event · copied as-is");
  });

  it("lets skip swallow every other action", () => {
    expect(normalizeActions([{ kind: "drop_location" }, { kind: "skip" }])).toEqual([{ kind: "skip" }]);
    expect(summarizeRule({ actions: [{ kind: "mark_private" }, { kind: "skip" }], conditions: [] })).toBe("Every event · not copied");
  });
});

describe("available kinds", () => {
  it("hides conditions already present and the all-day/timed opposite", () => {
    expect(availableConditionKinds([])).toEqual(["title_contains", "all_day", "timed", "focus_time", "out_of_office"]);
    expect(availableConditionKinds([{ kind: "all_day" }, { kind: "focus_time" }])).toEqual(["title_contains", "out_of_office"]);
    expect(availableConditionKinds([{ kind: "title_contains", value: "x" }])).toContain("title_contains");
  });

  it("offers nothing after skip and never repeats an action", () => {
    expect(availableActionKinds([{ kind: "skip" }])).toEqual([]);
    expect(availableActionKinds([{ kind: "rename", template: "x" }, { kind: "mark_private" }]))
      .toEqual(["skip", "drop_description", "drop_location"]);
  });
});

describe("list helpers", () => {
  it("moves, removes, and replaces without touching the original", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, 5)).toBe(list);
    expect(removeAt(list, 1)).toEqual(["a", "c"]);
    expect(replaceAt(list, 1, "z")).toEqual(["a", "z", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("resolves applied rules in pair order and the rest as unapplied", () => {
    const rules = [rule("busy", true), rule("skip"), rule("ooo")];
    expect(resolveAppliedRules(["ooo", "missing", "busy"], rules).map((entry) => entry.id)).toEqual(["ooo", "busy"]);
    expect(resolveUnappliedRules(["ooo"], rules).map((entry) => entry.id)).toEqual(["busy", "skip"]);
    expect(resolveDefaultRule(rules)?.id).toBe("busy");
    expect(resolveDefaultRule([rule("only")])?.id).toBe("only");
  });
});

describe("pairs", () => {
  const sources = [makeSource("work", "a"), makeSource("personal", "b"), makeSource("family", "b"), makeSource("feed", "c", ["push"])];
  const groups = buildPairGroups(sources, {
    family: detail("family", []),
    personal: detail("personal", ["work"]),
    work: detail("work", ["personal", "family", "gone"]),
  });

  it("groups mapped destinations under pull-capable sources", () => {
    expect(groups.map((group) => group.source.id)).toEqual(["work", "personal"]);
    expect(groups[0]?.destinations.map((destination) => destination.id)).toEqual(["personal", "family"]);
    expect(countPairs(groups)).toBe(3);
    expect(findPair(groups, "personal", "work")?.destination.id).toBe("work");
    expect(findPair(groups, "work", "gone")).toBeUndefined();
  });

  it("splits pairs by whether a rule is assigned to them", () => {
    const { assigned, unassigned } = splitPairsByAssignment(groups, [{ destinationId: "family", sourceId: "work" }]);
    expect(assigned.map((pair) => pair.destination.id)).toEqual(["family"]);
    expect(unassigned.map((pair) => `${pair.source.id}>${pair.destination.id}`)).toEqual(["work>personal", "personal>work"]);
  });
});

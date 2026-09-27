import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULE,
  applyRuleActions,
  areRuleActionsEqual,
  createSyncRuleBodySchema,
  evaluateRules,
  patchSyncRuleBodySchema,
  resolveEventNameTemplate,
  ruleActionSchema,
  ruleConditionSchema,
  syncRuleNameSchema,
  type RuleEventFacts,
  type SyncRule,
} from "../src/index";

const facts = (overrides: Partial<RuleEventFacts> = {}): RuleEventFacts => ({
  calendarName: "Work",
  description: "Agenda",
  isAllDay: false,
  isFocusTime: false,
  isOutOfOffice: false,
  location: "Room 4",
  title: "Daily Standup",
  ...overrides,
});

const rule = (
  conditions: SyncRule["conditions"],
  actions: SyncRule["actions"],
): Pick<SyncRule, "actions" | "conditions"> => ({ actions, conditions });

describe("rule schemas", () => {
  it("rejects unknown keys and empty title conditions", () => {
    expect(ruleConditionSchema.allows({ kind: "title_contains", value: "Standup" })).toBe(true);
    expect(ruleConditionSchema.allows({ kind: "title_contains", value: "" })).toBe(false);
    expect(ruleConditionSchema.allows({ kind: "all_day", value: "x" })).toBe(false);
    expect(ruleConditionSchema.allows({ kind: "weekday" })).toBe(false);
    expect(ruleActionSchema.allows({ kind: "rename", template: "OOO" })).toBe(true);
    expect(ruleActionSchema.allows({ kind: "rename" })).toBe(false);
    expect(ruleActionSchema.allows({ kind: "skip", template: "x" })).toBe(false);
  });

  it("validates bodies and names", () => {
    expect(createSyncRuleBodySchema.allows({ name: "Standup to OOO" })).toBe(true);
    expect(createSyncRuleBodySchema.allows({ name: "x", extra: true })).toBe(false);
    expect(patchSyncRuleBodySchema.allows({ conditions: [{ kind: "timed" }] })).toBe(true);
    expect(patchSyncRuleBodySchema.allows({})).toBe(true);
    expect(syncRuleNameSchema.allows("   ")).toBe(false);
    expect(syncRuleNameSchema.allows("a".repeat(81))).toBe(false);
    expect(syncRuleNameSchema.allows("Busy only")).toBe(true);
  });
});

describe("evaluateRules", () => {
  it("matches every event when a rule has no conditions", () => {
    const result = evaluateRules([rule([], [])], facts());
    expect(result).toEqual({ description: "Agenda", location: "Room 4", skip: false, summary: "Daily Standup" });
  });

  it("ands conditions and lets the first matching rule decide", () => {
    const rules = [
      rule([{ kind: "title_contains", value: "standup" }, { kind: "all_day" }], [{ kind: "skip" }]),
      rule([{ kind: "title_contains", value: "STANDUP" }], [{ kind: "rename", template: "OOO" }]),
      rule([], [{ kind: "mark_private" }]),
    ];
    expect(evaluateRules(rules, facts())).toMatchObject({ skip: false, summary: "OOO" });
    expect(evaluateRules(rules, facts({ isAllDay: true }))).toEqual({ skip: true });
    expect(evaluateRules(rules, facts({ title: "Lunch" }))).toMatchObject({ isPrivate: true, summary: "Lunch" });
  });

  it("ors conditions when a rule matches any of them", () => {
    const anyRule = {
      ...rule([{ kind: "title_contains", value: "1:1" }, { kind: "all_day" }], [{ kind: "skip" }]),
      match: "any" as const,
    };
    expect(evaluateRules([anyRule], facts({ title: "1:1 with Priya" }))).toEqual({ skip: true });
    expect(evaluateRules([anyRule], facts({ isAllDay: true }))).toEqual({ skip: true });
    expect(evaluateRules([anyRule, rule([], [])], facts())).toMatchObject({ skip: false });
    expect(evaluateRules([{ ...rule([], [{ kind: "skip" }]), match: "any" as const }], facts())).toEqual({ skip: true });
  });

  it("skips events no rule matches", () => {
    expect(evaluateRules([rule([{ kind: "focus_time" }], [])], facts())).toEqual({ skip: true });
    expect(evaluateRules([], facts())).toEqual({ skip: true });
  });

  it("lets skip win over every other action", () => {
    expect(applyRuleActions([{ kind: "rename", template: "x" }, { kind: "skip" }], facts())).toEqual({ skip: true });
  });

  it("reproduces the legacy default projection", () => {
    expect(evaluateRules([DEFAULT_RULE], facts())).toEqual({ skip: false, summary: "Work" });
  });

  it("falls back from an empty template to the calendar name and then to Busy", () => {
    expect(resolveEventNameTemplate("", { calendar_name: "Work", event_name: "x" })).toBe("Work");
    expect(resolveEventNameTemplate("  ", { calendar_name: "", event_name: "x" })).toBe("Busy");
    expect(resolveEventNameTemplate("{{event_name}} ({{calendar_name}})", { calendar_name: "Work", event_name: "Standup" })).toBe("Standup (Work)");
    expect(resolveEventNameTemplate("{{unknown}}", { calendar_name: "Work", event_name: "x" })).toBe("{{unknown}}");
  });

  it("compares actions ignoring template whitespace", () => {
    expect(areRuleActionsEqual([{ kind: "rename", template: " OOO " }], [{ kind: "rename", template: "OOO" }])).toBe(true);
    expect(areRuleActionsEqual([{ kind: "skip" }], [{ kind: "drop_location" }])).toBe(false);
  });
});

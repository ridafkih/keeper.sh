import { describe, expect, it } from "vitest";
import {
  applyRuleActions,
  evaluateRules,
  resolveEventNameTemplate,
  ruleActionSchema,
  ruleConditionSchema,
  shareAsActions,
  syncRuleNameSchema,
  type RuleAction,
  type RuleCondition,
  type RuleEventFacts,
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
  conditions: RuleCondition[],
  actions: RuleAction[],
): { actions: RuleAction[]; conditions: RuleCondition[] } => ({ actions, conditions });

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

  it("validates rule names", () => {
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

  it("reproduces the legacy default projection with Busy Only", () => {
    expect(evaluateRules([rule([], shareAsActions("busy_only", null))], facts())).toEqual({ skip: false, summary: "Work" });
  });

  it("falls back from an empty template to the calendar name and then to Busy", () => {
    expect(resolveEventNameTemplate("", { calendar_name: "Work", event_name: "x" })).toBe("Work");
    expect(resolveEventNameTemplate("  ", { calendar_name: "", event_name: "x" })).toBe("Busy");
    expect(resolveEventNameTemplate("{{event_name}} ({{calendar_name}})", { calendar_name: "Work", event_name: "Standup" })).toBe("Standup (Work)");
    expect(resolveEventNameTemplate("{{unknown}}", { calendar_name: "Work", event_name: "x" })).toBe("{{unknown}}");
  });
});

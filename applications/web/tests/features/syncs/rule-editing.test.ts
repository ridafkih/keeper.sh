import { describe, expect, it } from "vitest";
import { MAX_RULE_CONDITIONS } from "@keeper.sh/data-schemas";
import type { AdvancedRule } from "@keeper.sh/data-schemas";
import {
  availableActionKinds,
  availableConditionKinds,
  createRuleId,
  moveItem,
  normalizeActions,
  removeAt,
  replaceAt,
  ruleProblem,
  templateVariablesFor,
} from "../../../src/features/syncs/rule-editing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const rule = (overrides: Partial<AdvancedRule> = {}): AdvancedRule => ({
  actions: [{ kind: "skip" }],
  conditions: [{ kind: "all_day" }],
  id: "r1",
  match: "all",
  name: "Days off",
  ...overrides,
});

describe("availableConditionKinds", () => {
  it("offers each kind once, keeps Title Contains, and leaves out the opposite of all-day when matching all", () => {
    expect(availableConditionKinds(rule())).toEqual(["title_contains", "focus_time", "out_of_office", "busy", "free", "tentative"]);
    expect(availableConditionKinds(rule({ match: "any" })))
      .toEqual(["title_contains", "timed", "focus_time", "out_of_office", "busy", "free", "tentative"]);
  });

  it("runs out at the schema's condition limit", () => {
    const conditions = Array.from({ length: MAX_RULE_CONDITIONS }, () => ({ kind: "title_contains" as const, value: "x" }));
    expect(availableConditionKinds(rule({ conditions }))).toEqual([]);
  });
});

describe("actions", () => {
  it("lets Don't Copy stand alone", () => {
    expect(normalizeActions([{ kind: "drop_location" }, { kind: "skip" }])).toEqual([{ kind: "skip" }]);
    expect(availableActionKinds([{ kind: "skip" }])).toEqual([]);
    expect(availableActionKinds([{ kind: "rename", template: "x" }])).toEqual(["skip", "drop_description", "drop_location", "mark_private"]);
  });
});

describe("list edits", () => {
  it("moves, removes and replaces without touching the original", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 0, 3)).toBe(list);
    expect(removeAt(list, 1)).toEqual(["a", "c"]);
    expect(replaceAt(list, 2, "z")).toEqual(["a", "b", "z"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("createRuleId", () => {
  it("makes a v4 uuid without crypto.randomUUID, which plain-HTTP pages don't have", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      const ids = new Set(Array.from({ length: 50 }, createRuleId));
      expect(ids.size).toBe(50);
      expect([...ids].every((id) => UUID.test(id))).toBe(true);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { configurable: true, value: original });
    }
  });
});

describe("templateVariablesFor", () => {
  it("hides the event's name from renames under Busy Only", () => {
    expect(Object.keys(templateVariablesFor("busy_only"))).toEqual(["calendar_name"]);
    expect(Object.keys(templateVariablesFor("title_only"))).toEqual(["calendar_name", "event_name"]);
  });
});

describe("ruleProblem", () => {
  it("names what a rule is missing", () => {
    expect(ruleProblem(rule())).toBeNull();
    expect(ruleProblem(rule({ conditions: [] }))).toBe("Days off needs a condition.");
    expect(ruleProblem(rule({ actions: [] }))).toBe("Days off needs an action.");
    expect(ruleProblem(rule({ conditions: [{ kind: "title_contains", value: "  " }] }))).toBe("Days off has an empty Title Contains.");
  });
});

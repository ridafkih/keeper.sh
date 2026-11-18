import { describe, expect, it } from "vitest";
import {
  NO_SYNC_RULE_OVERRIDES,
  SYNC_RULE_FIELDS,
  hasSyncRuleOverrides,
  listOverriddenSyncRuleFields,
  resolveSyncRules,
  syncRuleOverridesPatchSchema,
} from "../src/index";
import type { SyncRuleOverrides, SyncRules } from "../src/index";

const SOURCE_RULES: SyncRules = {
  customEventName: "{{calendar_name}}",
  disableEventReminders: true,
  excludeAllDayEvents: true,
  excludeAvailabilities: ["free"],
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  excludeFocusTime: true,
  excludeOutOfOffice: true,
  excludeTitleKeywords: ["lunch"],
  markEventsAsPrivate: true,
};

const OPPOSITE_RULES: SyncRules = {
  customEventName: "Busy",
  disableEventReminders: false,
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: [],
  markEventsAsPrivate: false,
};

const overriding = (overrides: Partial<SyncRuleOverrides>): SyncRuleOverrides => ({
  ...NO_SYNC_RULE_OVERRIDES,
  ...overrides,
});

describe("resolveSyncRules", () => {
  it.each([
    ["absent", new Map<string, SyncRuleOverrides>().get("unmapped")],
    ["null", null],
    ["all unset", NO_SYNC_RULE_OVERRIDES],
  ])("returns the source rules when overrides are %s", (_label, overrides) => {
    expect(resolveSyncRules(SOURCE_RULES, overrides)).toEqual(SOURCE_RULES);
  });

  it("replaces every rule when every field is overridden", () => {
    expect(resolveSyncRules(SOURCE_RULES, OPPOSITE_RULES)).toEqual(OPPOSITE_RULES);
  });

  it.each(SYNC_RULE_FIELDS)("overrides %s without touching the other rules", (field) => {
    const resolved = resolveSyncRules(SOURCE_RULES, overriding({ [field]: OPPOSITE_RULES[field] }));

    expect(resolved).toEqual({ ...SOURCE_RULES, [field]: OPPOSITE_RULES[field] });
  });

  it("treats false, an empty list and an empty string as set overrides", () => {
    const resolved = resolveSyncRules(
      SOURCE_RULES,
      overriding({ customEventName: "", excludeEventName: false, excludeTitleKeywords: [] }),
    );

    expect(resolved.customEventName).toBe("");
    expect(resolved.excludeEventName).toBe(false);
    expect(resolved.excludeTitleKeywords).toEqual([]);
  });

  it("does not mutate the source rules or the overrides", () => {
    const source = structuredClone(SOURCE_RULES);
    const overrides = overriding({ excludeTitleKeywords: ["gym"] });
    const overridesBefore = structuredClone(overrides);

    resolveSyncRules(source, overrides);

    expect(source).toEqual(SOURCE_RULES);
    expect(overrides).toEqual(overridesBefore);
  });
});

describe("NO_SYNC_RULE_OVERRIDES", () => {
  it("covers exactly the sync rule fields, all unset", () => {
    expect(Object.keys(NO_SYNC_RULE_OVERRIDES).toSorted()).toEqual([...SYNC_RULE_FIELDS].toSorted());
    expect(Object.values(NO_SYNC_RULE_OVERRIDES).every((value) => value === null)).toBe(true);
  });

  it("cannot be modified by a caller", () => {
    expect(Object.isFrozen(NO_SYNC_RULE_OVERRIDES)).toBe(true);
  });
});

describe("listOverriddenSyncRuleFields", () => {
  it("lists nothing for absent or unset overrides", () => {
    expect(listOverriddenSyncRuleFields(null)).toEqual([]);
    expect(listOverriddenSyncRuleFields(NO_SYNC_RULE_OVERRIDES)).toEqual([]);
    expect(hasSyncRuleOverrides(NO_SYNC_RULE_OVERRIDES)).toBe(false);
  });

  it("counts false and empty values as overridden", () => {
    const overrides = overriding({ excludeAvailabilities: [], markEventsAsPrivate: false });

    expect(listOverriddenSyncRuleFields(overrides))
      .toEqual(["excludeAvailabilities", "markEventsAsPrivate"]);
    expect(hasSyncRuleOverrides(overrides)).toBe(true);
  });
});

describe("syncRuleOverridesPatchSchema", () => {
  it("accepts every field set to a value", () => {
    expect(syncRuleOverridesPatchSchema.allows(OPPOSITE_RULES)).toBe(true);
    expect(syncRuleOverridesPatchSchema.allows(SOURCE_RULES)).toBe(true);
  });

  it("accepts every field set to null", () => {
    expect(syncRuleOverridesPatchSchema.allows(NO_SYNC_RULE_OVERRIDES)).toBe(true);
  });

  it("accepts a partial patch", () => {
    expect(syncRuleOverridesPatchSchema.allows({ excludeEventName: null })).toBe(true);
  });

  it.each([
    ["an unknown field", { includeInIcalFeed: true }],
    ["a string for a boolean", { excludeEventName: "true" }],
    ["an unknown availability", { excludeAvailabilities: ["asleep"] }],
    ["a non-array keyword list", { excludeTitleKeywords: "lunch" }],
    ["an undefined-like number", { markEventsAsPrivate: 0 }],
  ])("rejects %s", (_label, body) => {
    expect(syncRuleOverridesPatchSchema.allows(body)).toBe(false);
  });
});

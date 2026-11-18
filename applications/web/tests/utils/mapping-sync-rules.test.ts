import { describe, expect, it } from "vitest";
import { NO_SYNC_RULE_OVERRIDES, resolveSyncRules } from "@keeper.sh/data-schemas";
import type { MappingSyncRules } from "../../src/types/api";
import {
  DETAIL_SWITCH_RULES,
  EXCLUSION_SWITCH_RULES,
  PROVIDER_EXCLUSION_SWITCH_RULES,
  RESET_ALL_OVERRIDES_PATCH,
  applyOverridePatch,
  buildAvailabilityTogglePatch,
  buildCustomTitleKeywordsPatch,
  buildEventNamePatch,
  buildSwitchPatch,
  formatEventNameState,
  formatExcludedAvailabilities,
  formatExcludedTitleKeywords,
  formatInherited,
  formatSwitchState,
  getExclusionSwitchRules,
  isSwitchRuleOn,
  resolveEventNameChoice,
  resolveReplacementTemplate,
  resolveSwitchChoice,
} from "../../src/utils/mapping-sync-rules";
import type { RuleOverrides, Rules, SwitchRule } from "../../src/utils/mapping-sync-rules";

const SOURCE_RULES: Rules = {
  customEventName: "{{calendar_name}}",
  disableEventReminders: false,
  excludeAllDayEvents: false,
  excludeAvailabilities: ["free"],
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: ["lunch"],
  markEventsAsPrivate: false,
};

const createMapping = (
  overrides: Partial<RuleOverrides> = {},
  sourceRules: Rules = SOURCE_RULES,
): MappingSyncRules => {
  const merged = { ...NO_SYNC_RULE_OVERRIDES, ...overrides };
  return {
    destinationCalendarId: "destination-1",
    effectiveRules: resolveSyncRules(sourceRules, merged),
    overrides: merged,
    sourceCalendarId: "source-1",
    sourceRules,
  };
};

const ALL_SWITCH_RULES: SwitchRule[] = [
  ...DETAIL_SWITCH_RULES,
  ...EXCLUSION_SWITCH_RULES,
  ...PROVIDER_EXCLUSION_SWITCH_RULES,
];

const SYNC_DESCRIPTION = DETAIL_SWITCH_RULES[0];
const MARK_PRIVATE = DETAIL_SWITCH_RULES[2];

describe("applyOverridePatch", () => {
  it("recomputes the effective rules from the patched overrides", () => {
    const patched = applyOverridePatch(createMapping(), { excludeEventName: false });

    expect(patched.overrides.excludeEventName).toBe(false);
    expect(patched.effectiveRules.excludeEventName).toBe(false);
    expect(patched.sourceRules).toEqual(SOURCE_RULES);
  });

  it("returns an inherited rule to the source value when its override is cleared", () => {
    const patched = applyOverridePatch(
      createMapping({ excludeEventName: false, markEventsAsPrivate: true }),
      { excludeEventName: null },
    );

    expect(patched.effectiveRules.excludeEventName).toBe(true);
    expect(patched.overrides.markEventsAsPrivate).toBe(true);
  });

  it("clears everything with the reset patch", () => {
    const patched = applyOverridePatch(
      createMapping({ customEventName: "Busy", excludeTitleKeywords: [] }),
      RESET_ALL_OVERRIDES_PATCH,
    );

    expect(patched.overrides).toEqual(NO_SYNC_RULE_OVERRIDES);
    expect(patched.effectiveRules).toEqual(SOURCE_RULES);
  });

  it("does not mutate the mapping it was given", () => {
    const mapping = createMapping();
    const snapshot = structuredClone(mapping);

    applyOverridePatch(mapping, { excludeEventName: false });

    expect(mapping).toEqual(snapshot);
  });
});

describe("switch rules", () => {
  it("covers each switchable rule exactly once", () => {
    const fields = ALL_SWITCH_RULES.map((rule) => rule.field);

    expect(new Set(fields).size).toBe(fields.length);
    expect([...fields].sort()).toEqual([
      "disableEventReminders",
      "excludeAllDayEvents",
      "excludeEventDescription",
      "excludeEventLocation",
      "excludeFocusTime",
      "excludeOutOfOffice",
      "markEventsAsPrivate",
    ]);
  });

  it("reads a sync rule as on when its exclude field is false", () => {
    expect(isSwitchRuleOn(SYNC_DESCRIPTION, SOURCE_RULES)).toBe(false);
    expect(isSwitchRuleOn(SYNC_DESCRIPTION, { ...SOURCE_RULES, excludeEventDescription: false }))
      .toBe(true);
  });

  it("reads a direct rule as on when its field is true", () => {
    expect(isSwitchRuleOn(MARK_PRIVATE, SOURCE_RULES)).toBe(false);
    expect(isSwitchRuleOn(MARK_PRIVATE, { ...SOURCE_RULES, markEventsAsPrivate: true })).toBe(true);
  });

  it.each(ALL_SWITCH_RULES)("round-trips every choice for $label", (rule) => {
    for (const choice of ["inherit", "on", "off"] as const) {
      const mapping = applyOverridePatch(createMapping(), buildSwitchPatch(rule, choice));

      expect(resolveSwitchChoice(rule, mapping.overrides)).toBe(choice);
      if (choice !== "inherit") {
        expect(isSwitchRuleOn(rule, mapping.effectiveRules)).toBe(choice === "on");
      }
    }
  });

  it.each(ALL_SWITCH_RULES)("patches only its own field for $label", (rule) => {
    expect(Object.keys(buildSwitchPatch(rule, "on"))).toEqual([rule.field]);
    expect(buildSwitchPatch(rule, "inherit")).toEqual({ [rule.field]: null });
  });

  it("offers focus time and out of office exclusions only for Google sources", () => {
    expect(getExclusionSwitchRules("google").map((rule) => rule.field)).toEqual([
      "excludeAllDayEvents",
      "excludeFocusTime",
      "excludeOutOfOffice",
    ]);
    expect(getExclusionSwitchRules("outlook").map((rule) => rule.field))
      .toEqual(["excludeAllDayEvents"]);
  });

  it("formats switch states and inherited values", () => {
    expect(formatSwitchState(true)).toBe("On");
    expect(formatSwitchState(false)).toBe("Off");
    expect(formatInherited("Off")).toBe("Default (Off)");
  });
});

describe("event name choice", () => {
  it("is inherited until the destination overrides whether names are hidden", () => {
    expect(resolveEventNameChoice(createMapping().overrides)).toBe("inherit");
    expect(resolveEventNameChoice(createMapping({ excludeEventName: false }).overrides))
      .toBe("show");
    expect(resolveEventNameChoice(createMapping({ excludeEventName: true }).overrides))
      .toBe("replace");
  });

  it("clears both name fields when returning to the calendar default", () => {
    const mapping = createMapping({ customEventName: "Busy", excludeEventName: true });

    expect(buildEventNamePatch(mapping, "inherit"))
      .toEqual({ customEventName: null, excludeEventName: null });
  });

  it("drops a leftover replacement when names are shown", () => {
    const mapping = createMapping({ customEventName: "Busy", excludeEventName: true });

    expect(buildEventNamePatch(mapping, "show"))
      .toEqual({ customEventName: null, excludeEventName: false });
  });

  it("keeps an existing replacement when replacing names", () => {
    const mapping = createMapping({ customEventName: "Busy" });

    expect(buildEventNamePatch(mapping, "replace"))
      .toEqual({ customEventName: "Busy", excludeEventName: true });
  });

  it("seeds the replacement from a source that already hides names", () => {
    const mapping = createMapping({}, { ...SOURCE_RULES, customEventName: "Personal" });

    expect(buildEventNamePatch(mapping, "replace").customEventName).toBe("Personal");
  });

  it("does not seed the replacement from a source that shows names", () => {
    const mapping = createMapping({}, {
      ...SOURCE_RULES,
      customEventName: "{{event_name}}",
      excludeEventName: false,
    });

    expect(buildEventNamePatch(mapping, "replace").customEventName).toBe("{{calendar_name}}");
  });

  it("falls back to the calendar name when the source replacement is blank", () => {
    const mapping = createMapping({}, { ...SOURCE_RULES, customEventName: "  " });

    expect(buildEventNamePatch(mapping, "replace").customEventName).toBe("{{calendar_name}}");
    expect(resolveReplacementTemplate(mapping.effectiveRules)).toBe("{{calendar_name}}");
  });

  it("describes whether names are shown or replaced", () => {
    expect(formatEventNameState(SOURCE_RULES)).toBe("Replaced");
    expect(formatEventNameState({ ...SOURCE_RULES, excludeEventName: false })).toBe("Shown");
  });
});

describe("status exclusions", () => {
  const OPTIONS = [
    { label: "Busy", value: "busy" },
    { label: "Free", value: "free" },
  ] as const;

  it("lists excluded statuses in option order", () => {
    expect(formatExcludedAvailabilities(OPTIONS, ["free", "busy"])).toBe("Busy, Free");
    expect(formatExcludedAvailabilities(OPTIONS, [])).toBe("None");
  });

  it("starts a custom list from the statuses already in effect", () => {
    expect(buildAvailabilityTogglePatch(SOURCE_RULES, "busy"))
      .toEqual({ excludeAvailabilities: ["free", "busy"] });
  });

  it("can override the source down to an empty list", () => {
    expect(buildAvailabilityTogglePatch(SOURCE_RULES, "free"))
      .toEqual({ excludeAvailabilities: [] });
  });
});

describe("title keyword exclusions", () => {
  it("formats the keywords in effect", () => {
    expect(formatExcludedTitleKeywords(["lunch", "gym"])).toBe("lunch, gym");
    expect(formatExcludedTitleKeywords([])).toBe("None");
  });

  it("starts a custom list as a copy of the keywords in effect", () => {
    const patch = buildCustomTitleKeywordsPatch(SOURCE_RULES);

    expect(patch).toEqual({ excludeTitleKeywords: ["lunch"] });
    expect(patch.excludeTitleKeywords).not.toBe(SOURCE_RULES.excludeTitleKeywords);
  });
});

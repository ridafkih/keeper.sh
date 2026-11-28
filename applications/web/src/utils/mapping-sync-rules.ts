import {
  DEFAULT_SOURCE_SYNC_RULES,
  NO_SYNC_RULE_OVERRIDES,
  resolveSyncRules,
} from "@keeper.sh/data-schemas";
import type {
  ExcludableAvailability,
  SyncRuleOverrides,
  SyncRules,
} from "@keeper.sh/data-schemas";
import type { MappingSyncRules } from "@/types/api";
import { formatTitleKeywords, toggleExcludedAvailability } from "@/utils/calendars";

export type RuleOverrides = SyncRuleOverrides<ExcludableAvailability>;
export type Rules = SyncRules<ExcludableAvailability>;
export type RuleOverridePatch = Partial<RuleOverrides>;

export type SwitchRuleField =
  | "disableEventReminders"
  | "excludeAllDayEvents"
  | "excludeEventDescription"
  | "excludeEventLocation"
  | "excludeEventMeetingLink"
  | "excludeFocusTime"
  | "excludeOutOfOffice"
  | "markEventsAsPrivate";

export interface SwitchRule {
  field: SwitchRuleField;
  label: string;
  onWhenFieldIs: boolean;
}

export const DETAIL_SWITCH_RULES: SwitchRule[] = [
  { field: "excludeEventDescription", label: "Sync Event Description", onWhenFieldIs: false },
  { field: "excludeEventLocation", label: "Sync Event Location", onWhenFieldIs: false },
  { field: "markEventsAsPrivate", label: "Mark Events as Private", onWhenFieldIs: true },
  { field: "disableEventReminders", label: "Disable Reminders", onWhenFieldIs: true },
];

export const PROVIDER_DETAIL_SWITCH_RULES: SwitchRule[] = [
  { field: "excludeEventMeetingLink", label: "Sync Meeting Links", onWhenFieldIs: false },
];

export const EXCLUSION_SWITCH_RULES: SwitchRule[] = [
  { field: "excludeAllDayEvents", label: "Exclude All Day Events", onWhenFieldIs: true },
];

export const PROVIDER_EXCLUSION_SWITCH_RULES: SwitchRule[] = [
  { field: "excludeFocusTime", label: "Exclude Focus Time Events", onWhenFieldIs: true },
  { field: "excludeOutOfOffice", label: "Exclude Out of Office Events", onWhenFieldIs: true },
];

const PROVIDERS_WITH_EXTRA_RULES = new Set(["google"]);

export const getDetailSwitchRules = (provider: string): SwitchRule[] => {
  if (PROVIDERS_WITH_EXTRA_RULES.has(provider)) {
    return [...DETAIL_SWITCH_RULES, ...PROVIDER_DETAIL_SWITCH_RULES];
  }
  return DETAIL_SWITCH_RULES;
};

export const getExclusionSwitchRules = (provider: string): SwitchRule[] => {
  if (PROVIDERS_WITH_EXTRA_RULES.has(provider)) {
    return [...EXCLUSION_SWITCH_RULES, ...PROVIDER_EXCLUSION_SWITCH_RULES];
  }
  return EXCLUSION_SWITCH_RULES;
};

export const applyOverridePatch = (
  mapping: MappingSyncRules,
  patch: RuleOverridePatch,
): MappingSyncRules => {
  const overrides = { ...mapping.overrides, ...patch };
  return {
    ...mapping,
    effectiveRules: resolveSyncRules(mapping.sourceRules, overrides),
    overrides,
  };
};

export const RESET_ALL_OVERRIDES_PATCH: RuleOverridePatch = { ...NO_SYNC_RULE_OVERRIDES };

export const isSwitchRuleOn = (rule: SwitchRule, rules: Rules): boolean =>
  rules[rule.field] === rule.onWhenFieldIs;

export const formatSwitchState = (on: boolean): string => {
  if (on) {
    return "On";
  }
  return "Off";
};

export const formatInherited = (value: string): string => `Default (${value})`;

export type SwitchChoice = "inherit" | "on" | "off";

export const resolveSwitchChoice = (rule: SwitchRule, overrides: RuleOverrides): SwitchChoice => {
  const override = overrides[rule.field];
  if (override === null) {
    return "inherit";
  }
  if (override === rule.onWhenFieldIs) {
    return "on";
  }
  return "off";
};

export const buildSwitchPatch = (rule: SwitchRule, choice: SwitchChoice): RuleOverridePatch => {
  if (choice === "inherit") {
    return { [rule.field]: null };
  }
  if (choice === "on") {
    return { [rule.field]: rule.onWhenFieldIs };
  }
  return { [rule.field]: !rule.onWhenFieldIs };
};

export type EventNameChoice = "inherit" | "show" | "replace";

export const resolveEventNameChoice = (overrides: RuleOverrides): EventNameChoice => {
  if (overrides.excludeEventName === null) {
    return "inherit";
  }
  if (overrides.excludeEventName) {
    return "replace";
  }
  return "show";
};

const resolveReplacementTemplateSeed = (mapping: MappingSyncRules): string => {
  if (mapping.overrides.customEventName) {
    return mapping.overrides.customEventName;
  }
  if (mapping.sourceRules.excludeEventName && mapping.sourceRules.customEventName.trim()) {
    return mapping.sourceRules.customEventName;
  }
  return DEFAULT_SOURCE_SYNC_RULES.customEventName;
};

export const buildEventNamePatch = (
  mapping: MappingSyncRules,
  choice: EventNameChoice,
): RuleOverridePatch => {
  if (choice === "inherit") {
    return { customEventName: null, excludeEventName: null };
  }
  if (choice === "show") {
    return { customEventName: null, excludeEventName: false };
  }
  return {
    customEventName: resolveReplacementTemplateSeed(mapping),
    excludeEventName: true,
  };
};

export const formatEventNameState = (rules: Rules): string => {
  if (rules.excludeEventName) {
    return "Replaced";
  }
  return "Shown";
};

export const resolveReplacementTemplate = (rules: Rules): string =>
  rules.customEventName.trim() || DEFAULT_SOURCE_SYNC_RULES.customEventName;

interface AvailabilityOption {
  label: string;
  value: ExcludableAvailability;
}

export const formatExcludedAvailabilities = (
  options: readonly AvailabilityOption[],
  excluded: readonly ExcludableAvailability[],
): string => {
  const labels = options
    .filter(({ value }) => excluded.includes(value))
    .map(({ label }) => label);
  if (labels.length === 0) {
    return "None";
  }
  return labels.join(", ");
};

export const buildAvailabilityTogglePatch = (
  rules: Rules,
  availability: ExcludableAvailability,
): RuleOverridePatch => ({
  excludeAvailabilities: toggleExcludedAvailability(rules.excludeAvailabilities, availability),
});

export const formatExcludedTitleKeywords = (keywords: string[]): string => {
  if (keywords.length === 0) {
    return "None";
  }
  return formatTitleKeywords(keywords);
};

export const buildCustomTitleKeywordsPatch = (rules: Rules): RuleOverridePatch => ({
  excludeTitleKeywords: [...rules.excludeTitleKeywords],
});

export const formatDestinationRulesState = (customized: boolean): string => {
  if (customized) {
    return "Customized";
  }
  return "Default";
};

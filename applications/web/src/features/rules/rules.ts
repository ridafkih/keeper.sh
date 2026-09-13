import type { CalendarDetail, CalendarSource } from "@/types/api";
import type { DetailChoice } from "@/features/setup/setup-draft";

export type TitleMode = DetailChoice | "custom";

export type SourceDetails = Record<string, CalendarDetail>;

export interface RuleRow {
  destination: CalendarSource;
  mode: TitleMode;
  customTitle: string;
}

export interface RuleGroup {
  source: CalendarSource;
  detail: CalendarDetail;
  rows: RuleRow[];
}

const DEFAULT_TEMPLATE = "{{calendar_name}}";

export const resolveTitleMode = (
  detail: Pick<CalendarDetail, "excludeEventName" | "customEventName">,
): TitleMode => {
  if (!detail.excludeEventName) return "titles";
  const template = detail.customEventName.trim();
  if (template === "" || template === DEFAULT_TEMPLATE) return "calendar_name";
  if (template === "Busy") return "busy";
  return "custom";
};

export const toDetailChoice = (mode: TitleMode): DetailChoice => (mode === "custom" ? "calendar_name" : mode);

export const titleModeLabel = (mode: TitleMode, customTitle: string): string => {
  if (mode === "busy") return "Busy";
  if (mode === "titles") return "Real titles";
  if (mode === "custom") return customTitle;
  return "Calendar name";
};

export const buildRuleGroups = (sources: CalendarSource[], details: SourceDetails): RuleGroup[] => {
  const byId = new Map(sources.map((source) => [source.id, source] as const));
  const groups: RuleGroup[] = [];
  for (const source of sources) {
    const detail = details[source.id];
    if (!detail) continue;
    const mode = resolveTitleMode(detail);
    const rows = detail.destinationIds
      .map((id) => byId.get(id))
      .filter((destination) => destination !== undefined)
      .map((destination) => ({ customTitle: detail.customEventName, destination, mode }));
    if (rows.length > 0) groups.push({ detail, rows, source });
  }
  return groups;
};

export const countRules = (groups: RuleGroup[]): number =>
  groups.reduce((total, group) => total + group.rows.length, 0);

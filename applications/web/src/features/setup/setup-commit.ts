import type { CompleteRule, DetailChoice } from "./setup-draft";

export interface SourcePatch {
  excludeEventName: boolean;
  customEventName: string;
}

export const DETAIL_PATCHES: Record<DetailChoice, SourcePatch> = {
  busy: { customEventName: "Busy", excludeEventName: true },
  calendar_name: { customEventName: "{{calendar_name}}", excludeEventName: true },
  titles: { customEventName: "{{event_name}}", excludeEventName: false },
};

const DEFAULT_DETAIL: DetailChoice = "calendar_name";

export interface DestinationPut {
  sourceId: string;
  calendarIds: string[];
}

export interface SourcePatchWrite {
  sourceId: string;
  body: SourcePatch;
}

export type ExistingDestinations = Record<string, string[]>;

export const buildDestinationPuts = (
  rules: CompleteRule[],
  existingByFrom: ExistingDestinations,
): DestinationPut[] => {
  const puts = new Map<string, string[]>();
  const replaced = new Set(rules.filter((rule) => rule.replace).map((rule) => rule.fromId));
  for (const rule of rules) {
    for (const toId of rule.toIds) {
      const base = replaced.has(rule.fromId) ? [] : existingByFrom[rule.fromId] ?? [];
      const existing = puts.get(rule.fromId) ?? base;
      if (existing.includes(toId)) continue;
      puts.set(rule.fromId, [...existing, toId]);
    }
  }
  const unchanged = (sourceId: string, calendarIds: string[]) => {
    const current = existingByFrom[sourceId] ?? [];
    return current.length === calendarIds.length && current.every((id) => calendarIds.includes(id));
  };
  return [...puts]
    .filter(([sourceId, calendarIds]) => !unchanged(sourceId, calendarIds))
    .map(([sourceId, calendarIds]) => ({ calendarIds, sourceId }));
};

export const buildSourcePatches = (rules: CompleteRule[]): SourcePatchWrite[] => {
  const patches = new Map<string, SourcePatch>();
  for (const rule of rules) {
    if (rule.detail === (rule.loadedDetail ?? DEFAULT_DETAIL) || patches.has(rule.fromId)) continue;
    patches.set(rule.fromId, DETAIL_PATCHES[rule.detail]);
  }
  return [...patches].map(([sourceId, body]) => ({ body, sourceId }));
};

export const countNewMappings = (puts: DestinationPut[], existingByFrom: ExistingDestinations): number =>
  puts.reduce((total, put) => total + put.calendarIds.length - (existingByFrom[put.sourceId]?.length ?? 0), 0);

export const exceedsMappingLimit = (projected: number, limit: number | null): boolean =>
  limit !== null && projected > limit;

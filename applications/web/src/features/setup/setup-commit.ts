import type { CompleteRule, DetailChoice } from "./setup-draft";

export interface SourcePatch {
  excludeEventName: boolean;
  customEventName: string;
}

export const DETAIL_PATCHES: Record<DetailChoice, SourcePatch | null> = {
  busy: { customEventName: "Busy", excludeEventName: true },
  calendar_name: null,
  titles: { customEventName: "{{event_name}}", excludeEventName: false },
};

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
  for (const rule of rules) {
    const existing = puts.get(rule.fromId) ?? existingByFrom[rule.fromId] ?? [];
    if (existing.includes(rule.toId)) continue;
    puts.set(rule.fromId, [...existing, rule.toId]);
  }
  return [...puts].map(([sourceId, calendarIds]) => ({ calendarIds, sourceId }));
};

export const buildSourcePatches = (rules: CompleteRule[]): SourcePatchWrite[] => {
  const patches = new Map<string, SourcePatch>();
  for (const rule of rules) {
    const body = DETAIL_PATCHES[rule.detail];
    if (body && !patches.has(rule.fromId)) patches.set(rule.fromId, body);
  }
  return [...patches].map(([sourceId, body]) => ({ body, sourceId }));
};

export const countNewMappings = (puts: DestinationPut[], existingByFrom: ExistingDestinations): number =>
  puts.reduce((total, put) => total + put.calendarIds.length - (existingByFrom[put.sourceId]?.length ?? 0), 0);

export const exceedsMappingLimit = (projected: number, limit: number | null): boolean =>
  limit !== null && projected > limit;

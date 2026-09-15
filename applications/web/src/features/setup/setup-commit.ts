import { uniquePairs, type CompleteRule } from "./setup-draft";

export interface DestinationPut {
  sourceId: string;
  calendarIds: string[];
}

export interface PairRulePut {
  sourceId: string;
  destinationId: string;
  ruleIds: string[];
}

export type ExistingDestinations = Record<string, string[]>;

export const buildDestinationPuts = (
  rules: CompleteRule[],
  existingByFrom: ExistingDestinations,
): DestinationPut[] => {
  const puts = new Map<string, string[]>();
  for (const rule of rules) {
    for (const toId of rule.toIds) {
      const existing = puts.get(rule.fromId) ?? existingByFrom[rule.fromId] ?? [];
      if (existing.includes(toId)) continue;
      puts.set(rule.fromId, [...existing, toId]);
    }
  }
  return [...puts].map(([sourceId, calendarIds]) => ({ calendarIds, sourceId }));
};

// A pair without a chosen rule keeps the default the server assigns it, so only explicit choices are written.
export const buildPairRulePuts = (rules: CompleteRule[]): PairRulePut[] =>
  uniquePairs(rules)
    .filter((pair) => pair.syncRuleId !== null)
    .map((pair) => ({ destinationId: pair.toId, ruleIds: [pair.syncRuleId as string], sourceId: pair.fromId }));

export const countNewMappings = (puts: DestinationPut[], existingByFrom: ExistingDestinations): number =>
  puts.reduce((total, put) => total + put.calendarIds.length - (existingByFrom[put.sourceId]?.length ?? 0), 0);

export const exceedsMappingLimit = (projected: number, limit: number | null): boolean =>
  limit !== null && projected > limit;

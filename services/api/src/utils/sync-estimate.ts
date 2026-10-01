import { compileSyncRules } from "@keeper.sh/data-schemas";
import type { CompiledSyncRule, SyncDefinition, SyncRange } from "@keeper.sh/data-schemas";

const NEAR_TERM_DAYS = 28;
const MS_PER_DAY = 86_400_000;

interface EstimateCalendar {
  id: string;
  syncFutureRange: SyncRange;
  syncHistoricRange: SyncRange;
}

interface EstimateWindow {
  timeMax: Date;
  timeMin: Date;
}

interface SyncEstimateDependencies {
  countCopies: (sourceCalendarIds: string[], window: EstimateWindow, rules: CompiledSyncRule[]) => Promise<Date[]>;
  resolveWindow: (historicRange: SyncRange, futureRange: SyncRange, now: Date) => EstimateWindow;
}

interface SyncEstimate {
  nearTerm: { count: number; days: number };
  total: { count: number; futureRange: SyncRange | null; historicRange: SyncRange | null };
}

// Each destination receives copies from the other calendars in the sync, over that destination's own window.
const destinationSources = (definition: SyncDefinition): { destinationId: string; sourceIds: string[] }[] => {
  if (definition.mode === "both_ways") {
    return definition.memberCalendarIds.map((destinationId) => ({
      destinationId,
      sourceIds: definition.memberCalendarIds.filter((id) => id !== destinationId),
    }));
  }
  return definition.destinationCalendarIds.map((destinationId) => ({
    destinationId,
    sourceIds: definition.sourceCalendarIds.filter((id) => id !== destinationId),
  }));
};

const sharedRange = (ranges: SyncRange[]): SyncRange | null => {
  const [first] = ranges;
  if (!first || ranges.some((range) => range !== first)) {
    return null;
  }
  return first;
};

const estimateSyncCopies = async (
  definition: SyncDefinition,
  calendars: ReadonlyMap<string, EstimateCalendar>,
  dependencies: SyncEstimateDependencies,
  now: Date = new Date(),
): Promise<SyncEstimate> => {
  const rules = compileSyncRules(definition);
  const nearTermEnd = now.getTime() + NEAR_TERM_DAYS * MS_PER_DAY;
  const destinations = destinationSources(definition).filter(({ destinationId }) => calendars.has(destinationId));
  let total = 0;
  let nearTerm = 0;

  for (const { destinationId, sourceIds } of destinations) {
    const destination = calendars.get(destinationId);
    if (!destination || sourceIds.length === 0) {
      continue;
    }
    const window = dependencies.resolveWindow(destination.syncHistoricRange, destination.syncFutureRange, now);
    const starts = await dependencies.countCopies(sourceIds, window, rules);
    total += starts.length;
    nearTerm += starts.filter((start) => start.getTime() >= now.getTime() && start.getTime() < nearTermEnd).length;
  }

  const ranges = destinations.flatMap(({ destinationId }) => calendars.get(destinationId) ?? []);
  return {
    nearTerm: { count: nearTerm, days: NEAR_TERM_DAYS },
    total: {
      count: total,
      futureRange: sharedRange(ranges.map(({ syncFutureRange }) => syncFutureRange)),
      historicRange: sharedRange(ranges.map(({ syncHistoricRange }) => syncHistoricRange)),
    },
  };
};

export { NEAR_TERM_DAYS, destinationSources, estimateSyncCopies };
export type { EstimateCalendar, EstimateWindow, SyncEstimate, SyncEstimateDependencies };

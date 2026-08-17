import type { CalendarKey, WithheldEvent } from "@keeper.sh/sync-protocol";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";

const withholdingCounters = [
  "overBudgetRecurrenceSeries",
  "emptyTimeRange",
  "invertedTimeRange",
  "missingSourceEventUid",
  "excludedBySyncPolicy",
  "outsideReconciliationWindow",
  "unparseableStoredPayload",
  "unresolvableTimeZone",
  "supersededRevision",
] as const;
type WithholdingCounter = (typeof withholdingCounters)[number];

interface WithheldSourceEvent {
  readonly sourceCalendar: CalendarKey;
  readonly event: WithheldEvent;
}

interface LocalReadCompleteness {
  readonly withheldCounts: Readonly<Record<WithholdingCounter, number>>;
  readonly withheld: readonly WithheldSourceEvent[];
}

const withheldTotalOf = (completeness: LocalReadCompleteness): number =>
  withholdingCounters.reduce((total, counter) => total + completeness.withheldCounts[counter], 0);

const readIsComplete = (completeness: LocalReadCompleteness): boolean =>
  withheldTotalOf(completeness) === 0;

const countsAgreeWithTheWithheldList = (completeness: LocalReadCompleteness): boolean =>
  withheldTotalOf(completeness) === completeness.withheld.length;

const withheldFromSource = (
  completeness: LocalReadCompleteness,
  sourceCalendar: CalendarKey,
): readonly WithheldEvent[] => {
  const wanted = calendarKeyString(sourceCalendar);
  return completeness.withheld
    .filter((withheld) => calendarKeyString(withheld.sourceCalendar) === wanted)
    .map((withheld) => withheld.event);
};

export {
  countsAgreeWithTheWithheldList,
  readIsComplete,
  withheldFromSource,
  withheldTotalOf,
  withholdingCounters,
};
export type { LocalReadCompleteness, WithheldSourceEvent, WithholdingCounter };

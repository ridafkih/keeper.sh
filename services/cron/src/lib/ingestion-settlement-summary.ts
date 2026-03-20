interface IngestionSettlementResult {
  eventsAdded: number;
  eventsRemoved: number;
  ingestEvents: Record<string, unknown>[];
}

interface IngestionSettlementSummary {
  added: number;
  removed: number;
  errors: number;
  ingestEvents: Record<string, unknown>[];
}

const summarizeIngestionSettlements = (
  settlements: PromiseSettledResult<IngestionSettlementResult>[],
): IngestionSettlementSummary => {
  const summary: IngestionSettlementSummary = {
    added: 0,
    removed: 0,
    errors: 0,
    ingestEvents: [],
  };

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      summary.added += settlement.value.eventsAdded;
      summary.removed += settlement.value.eventsRemoved;
      summary.ingestEvents.push(...settlement.value.ingestEvents);
      continue;
    }
    summary.errors += 1;
  }

  return summary;
};

export { summarizeIngestionSettlements };
export type { IngestionSettlementResult, IngestionSettlementSummary };

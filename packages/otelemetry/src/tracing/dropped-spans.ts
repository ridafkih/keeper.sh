type SpanDropReason = "queue_full" | "export_failed" | "export_timeout";

interface DroppedSpansReport {
  total: number;
  byReason: Partial<Record<SpanDropReason, number>>;
}

interface DroppedSpansReporter {
  record: (reason: SpanDropReason, count: number) => void;
  flush: () => void;
  stop: () => void;
}

const createDroppedSpansReporter = (
  reportIntervalMillis: number,
  writeReport: (report: DroppedSpansReport) => void,
): DroppedSpansReporter => {
  let pending: DroppedSpansReport = { total: 0, byReason: {} };

  const flush = () => {
    if (pending.total === 0) {
      return;
    }
    const report = pending;
    pending = { total: 0, byReason: {} };
    writeReport(report);
  };

  const timer = setInterval(flush, reportIntervalMillis);
  timer.unref();

  return {
    record: (reason, count) => {
      if (count === 0) {
        return;
      }
      pending.total += count;
      pending.byReason[reason] = (pending.byReason[reason] ?? 0) + count;
    },
    flush,
    stop: () => {
      clearInterval(timer);
      flush();
    },
  };
};

export { createDroppedSpansReporter };
export type { DroppedSpansReport, DroppedSpansReporter, SpanDropReason };

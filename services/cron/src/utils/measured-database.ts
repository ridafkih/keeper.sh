import { recordSegment } from "@keeper.sh/calendar";
import type { ConcurrencyGate, IngestSegmentKey } from "@keeper.sh/calendar";
import { widelog } from "@/utils/logging";

interface CounterRecorder {
  count(name: string, value: number): void;
  max(name: string, value: number): void;
}

interface MeasuredDatabaseDependencies {
  counters: CounterRecorder;
  now: () => number;
  recordSegment: (name: IngestSegmentKey, ms: number) => void;
}

const defaultDependencies: MeasuredDatabaseDependencies = {
  counters: widelog,
  now: () => performance.now(),
  recordSegment,
};

const countQueuedQuery = (hasFreePermit: boolean): number => {
  if (hasFreePermit) {
    return 0;
  }
  return 1;
};

const runGatedStatement = async <TResult>(
  gate: ConcurrencyGate,
  statement: () => PromiseLike<TResult>,
  workKey: IngestSegmentKey,
  waitKey: IngestSegmentKey,
  dependencies: MeasuredDatabaseDependencies,
): Promise<TResult> => {
  dependencies.counters.count("database.queries.count", 1);
  dependencies.counters.count(
    "database.queries.queued_count",
    countQueuedQuery(gate.hasFreePermit()),
  );
  const queuedAt = dependencies.now();
  return await gate.run(async () => {
    dependencies.recordSegment(waitKey, dependencies.now() - queuedAt);
    dependencies.counters.max("database.pool.in_flight", gate.inFlight());
    const startedAt = dependencies.now();
    try {
      return await statement();
    } finally {
      dependencies.recordSegment(workKey, dependencies.now() - startedAt);
    }
  });
};

const measureDatabaseRead = async <TResult>(
  gate: ConcurrencyGate,
  read: () => PromiseLike<TResult>,
  dependencies: MeasuredDatabaseDependencies = defaultDependencies,
): Promise<TResult> => {
  dependencies.counters.count("db.read_count", 1);
  return await runGatedStatement(
    gate,
    read,
    "work.db_read_ms",
    "wait.read_gate_ms",
    dependencies,
  );
};

const measureDatabaseWrite = async <TResult>(
  gate: ConcurrencyGate,
  write: () => PromiseLike<TResult>,
  dependencies: MeasuredDatabaseDependencies = defaultDependencies,
): Promise<TResult> => {
  dependencies.counters.count("db.write_count", 1);
  return await runGatedStatement(
    gate,
    write,
    "work.db_write_ms",
    "wait.write_gate_ms",
    dependencies,
  );
};

export { measureDatabaseRead, measureDatabaseWrite };
export type { CounterRecorder, MeasuredDatabaseDependencies };

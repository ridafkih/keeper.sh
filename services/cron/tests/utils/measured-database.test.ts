import { describe, expect, it } from "vitest";
import { measureDatabaseRead, measureDatabaseWrite } from "../../src/utils/measured-database";
import type { ConcurrencyGate } from "@keeper.sh/calendar";

const GATE_DELAY_MS = 50;
const STATEMENT_DELAY_MS = 5;

interface TestClock {
  advance: (durationMs: number) => Promise<null>;
  now: () => number;
}

const createClock = (): TestClock => {
  let elapsedMs = 0;
  return {
    advance: async (durationMs: number): Promise<null> => {
      elapsedMs += durationMs;
      return await Promise.resolve(null);
    },
    now: (): number => elapsedMs,
  };
};

interface RecordedSegment {
  name: string;
  ms: number;
}

const createSegmentRecorder = (): {
  segments: RecordedSegment[];
  record: (name: string, ms: number) => void;
} => {
  const segments: RecordedSegment[] = [];
  return {
    record: (name: string, ms: number): void => {
      segments.push({ ms, name });
    },
    segments,
  };
};

const createCounterRecorder = (): {
  counts: RecordedSegment[];
  maxima: RecordedSegment[];
  counters: { count: (name: string, value: number) => void; max: (name: string, value: number) => void };
} => {
  const counts: RecordedSegment[] = [];
  const maxima: RecordedSegment[] = [];
  return {
    counters: {
      count: (name: string, value: number): void => {
        counts.push({ ms: value, name });
      },
      max: (name: string, value: number): void => {
        maxima.push({ ms: value, name });
      },
    },
    counts,
    maxima,
  };
};

const IN_FLIGHT_DURING_RUN = 3;

const createFreeGate = (inFlightDuringRun: number): ConcurrencyGate => {
  let admitted = false;
  const inFlight = (): number => {
    if (admitted) {
      return inFlightDuringRun;
    }
    return 0;
  };
  return {
    hasFreePermit: () => true,
    inFlight,
    run: async <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
      admitted = true;
      try {
        return await operation();
      } finally {
        admitted = false;
      }
    },
  };
};

const createDelayingGate = (clock: TestClock, delayMs: number): ConcurrencyGate => ({
  hasFreePermit: () => false,
  inFlight: () => 1,
  run: async <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
    await clock.advance(delayMs);
    return await operation();
  },
});

describe("measureDatabaseRead", () => {
  it("charges only statement execution to work.db_read_ms, never the gate wait", async () => {
    const clock = createClock();
    const gate = createDelayingGate(clock, GATE_DELAY_MS);
    const recorder = createSegmentRecorder();
    const { counters } = createCounterRecorder();

    const result = await measureDatabaseRead(
      gate,
      async () => {
        await clock.advance(STATEMENT_DELAY_MS);
        return "rows";
      },
      { counters, now: clock.now, recordSegment: recorder.record },
    );

    expect(result).toBe("rows");
    const workSegments = recorder.segments.filter(
      (segment) => segment.name === "work.db_read_ms",
    );
    expect(workSegments).toHaveLength(1);
    expect(workSegments[0]?.ms).toBe(STATEMENT_DELAY_MS);
  });

  it("records the gate wait as wait.read_gate_ms", async () => {
    const clock = createClock();
    const gate = createDelayingGate(clock, GATE_DELAY_MS);
    const recorder = createSegmentRecorder();
    const { counters } = createCounterRecorder();

    await measureDatabaseRead(
      gate,
      async () => {
        await clock.advance(STATEMENT_DELAY_MS);
        return "rows";
      },
      { counters, now: clock.now, recordSegment: recorder.record },
    );

    const waitSegments = recorder.segments.filter(
      (segment) => segment.name === "wait.read_gate_ms",
    );
    expect(waitSegments).toHaveLength(1);
    expect(waitSegments[0]?.ms).toBe(GATE_DELAY_MS);
  });

  it("keeps the query counters: one read, one query, queued only when contended", async () => {
    const contendedGate = createDelayingGate(createClock(), GATE_DELAY_MS);
    const contended = createCounterRecorder();
    await measureDatabaseRead(
      contendedGate,
      () => Promise.resolve("rows"),
      { counters: contended.counters, now: () => 0, recordSegment: (): null => null },
    );

    expect(contended.counts).toContainEqual({ ms: 1, name: "db.read_count" });
    expect(contended.counts).toContainEqual({ ms: 1, name: "database.queries.count" });
    expect(contended.counts).toContainEqual({ ms: 1, name: "database.queries.queued_count" });

    const freeGate = createFreeGate(IN_FLIGHT_DURING_RUN);
    const free = createCounterRecorder();
    await measureDatabaseRead(
      freeGate,
      () => Promise.resolve("rows"),
      { counters: free.counters, now: () => 0, recordSegment: (): null => null },
    );

    expect(free.counts).toContainEqual({ ms: 1, name: "db.read_count" });
    expect(free.counts).toContainEqual({ ms: 1, name: "database.queries.count" });
    expect(free.counts).toContainEqual({ ms: 0, name: "database.queries.queued_count" });
  });

  it("records the pool in-flight maximum from inside the gate", async () => {
    const gate = createFreeGate(IN_FLIGHT_DURING_RUN);
    const { counters, maxima } = createCounterRecorder();

    await measureDatabaseRead(
      gate,
      () => Promise.resolve("rows"),
      { counters, now: () => 0, recordSegment: (): null => null },
    );

    expect(maxima).toContainEqual({
      ms: IN_FLIGHT_DURING_RUN,
      name: "database.pool.in_flight",
    });
  });
});

describe("measureDatabaseWrite", () => {
  it("keeps the write counters: one write, one query", async () => {
    const gate = createFreeGate(IN_FLIGHT_DURING_RUN);
    const { counters, counts } = createCounterRecorder();

    await measureDatabaseWrite(
      gate,
      () => Promise.resolve("written"),
      { counters, now: () => 0, recordSegment: (): null => null },
    );

    expect(counts).toContainEqual({ ms: 1, name: "db.write_count" });
    expect(counts).toContainEqual({ ms: 1, name: "database.queries.count" });
    expect(counts).toContainEqual({ ms: 0, name: "database.queries.queued_count" });
  });

  it("charges only statement execution to work.db_write_ms and the gate wait to wait.write_gate_ms", async () => {
    const clock = createClock();
    const gate = createDelayingGate(clock, GATE_DELAY_MS);
    const recorder = createSegmentRecorder();
    const { counters } = createCounterRecorder();

    const result = await measureDatabaseWrite(
      gate,
      async () => {
        await clock.advance(STATEMENT_DELAY_MS);
        return "written";
      },
      { counters, now: clock.now, recordSegment: recorder.record },
    );

    expect(result).toBe("written");
    const workSegments = recorder.segments.filter(
      (segment) => segment.name === "work.db_write_ms",
    );
    expect(workSegments).toHaveLength(1);
    expect(workSegments[0]?.ms).toBe(STATEMENT_DELAY_MS);

    const waitSegments = recorder.segments.filter(
      (segment) => segment.name === "wait.write_gate_ms",
    );
    expect(waitSegments).toHaveLength(1);
    expect(waitSegments[0]?.ms).toBe(GATE_DELAY_MS);
  });
});

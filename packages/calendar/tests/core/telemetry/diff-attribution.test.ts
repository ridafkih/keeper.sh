import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { SourceEvent } from "../../../src/core/types";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { IngestionPersistenceWork, IngestionResult } from "../../../src/core/sync-engine/ingest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";

type EmittedEvent = Record<string, unknown>;

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const SOURCE_EVENT_COUNT = 4000;
const POLL_INTERVAL_MS = 1;

const buildSourceEvents = (): SourceEvent[] =>
  Array.from({ length: SOURCE_EVENT_COUNT }, (unused, index) => ({
    endTime: new Date(Date.UTC(2026, 0, 1, 1, index % 60)),
    startTime: new Date(Date.UTC(2026, 0, 1, 0, index % 60)),
    title: `Event ${String(index)}`,
    uid: `uid-${String(index)}`,
  }));

const findEvent = (marker: string): EmittedEvent => {
  const event = emitted.find((candidate) => candidate["marker"] === marker);
  if (!event) {
    throw new Error(`no wide event emitted for ${marker}`);
  }
  return event;
};

const readOptional = (event: EmittedEvent, key: string): unknown => {
  let node: unknown = event;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node;
};

const readNumber = (event: EmittedEvent, key: string): number => {
  const value = readOptional(event, key);
  if (typeof value !== "number") {
    throw new TypeError(`expected ${key} to be a number on ${String(event["marker"])}`);
  }
  return value;
};

/*
 * A pooled driver invokes a queued transaction's callback in the async context of
 * whoever released the connection. This double reproduces exactly that: the work
 * callback is handed out and run from a foreign wide-event context.
 */
const createHandOffTransaction = (
  storedEvents: StoredSourceEventState[],
): {
  runWorkFromForeignContext: () => Promise<void>;
  withPersistenceTransaction: (work: IngestionPersistenceWork) => Promise<IngestionResult>;
} => {
  const handOff = { work: null as IngestionPersistenceWork | null };

  const withPersistenceTransaction = (work: IngestionPersistenceWork) =>
    new Promise<IngestionResult>((resolve, reject) => {
      handOff.work = (persistence) => {
        const running = work(persistence);
        running.then(resolve).catch(reject);
        return running;
      };
    });

  const runWorkFromForeignContext = async (): Promise<void> => {
    while (handOff.work === null) {
      await Bun.sleep(POLL_INTERVAL_MS);
    }
    await handOff.work({
      flush: () => Promise.resolve(),
      readExistingEvents: () => Promise.resolve(storedEvents),
    });
  };

  return { runWorkFromForeignContext, withPersistenceTransaction };
};

describe("work.diff_ms attribution across the transaction boundary", () => {
  it("charges the diff to the ingesting source, not to whoever released the connection", async () => {
    const { runWorkFromForeignContext, withPersistenceTransaction } =
      createHandOffTransaction([]);

    const ingestion = context(async () => {
      widelog.set("marker", "ingesting-source");
      await ingestSource({
        calendarId: "calendar-under-test",
        fetchEvents: () => Promise.resolve({ events: buildSourceEvents() }),
        onIngestEvent: (fields) => {
          widelog.setFields(fields);
        },
        withPersistenceTransaction,
      });
      widelog.flush();
    });

    await context(async () => {
      widelog.set("marker", "connection-releaser");
      await runWorkFromForeignContext();
      widelog.flush();
    });

    await ingestion;

    const ingestEvent = findEvent("ingesting-source");
    const releaserEvent = findEvent("connection-releaser");

    expect(readNumber(ingestEvent, "work.diff_ms")).toBeGreaterThan(0);
    expect(readNumber(ingestEvent, "accounted_ms"))
      .toBeCloseTo(readNumber(ingestEvent, "work.diff_ms"), 2);
    expect(readOptional(releaserEvent, "work.diff_ms")).toBeUndefined();
    expect(readOptional(releaserEvent, "accounted_ms")).toBeUndefined();
  });

  it("keeps the diff inside the duration it decomposes", async () => {
    const { runWorkFromForeignContext, withPersistenceTransaction } =
      createHandOffTransaction([]);

    const ingestion = context(async () => {
      widelog.set("marker", "bounded-source");
      await ingestSource({
        calendarId: "calendar-under-test",
        fetchEvents: () => Promise.resolve({ events: buildSourceEvents() }),
        onIngestEvent: (fields) => {
          widelog.setFields(fields);
        },
        withPersistenceTransaction,
      });
      widelog.flush();
    });

    await context(() => runWorkFromForeignContext());
    await ingestion;

    const event = findEvent("bounded-source");
    expect(readNumber(event, "work.diff_ms"))
      .toBeLessThanOrEqual(readNumber(event, "duration_ms") + 1);
  });
});

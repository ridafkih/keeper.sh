import { describe, expect, test } from "bun:test";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import {
  runSourceIngestionUnit,
  type SourceIngestionFailureDecision,
  type SourceIngestionLogger,
  type SourceIngestionRuntime,
} from "./source-ingestion-runner";
import { SourceIngestionFailureLogSlug } from "./source-ingestion-failure";

interface FlushedEvent {
  fields: Record<string, unknown>;
}

const createCapturingLogger = (): {
  logger: SourceIngestionLogger;
  flushedEvents: FlushedEvent[];
} => {
  const fields = new Map<string, unknown>();
  const flushedEvents: FlushedEvent[] = [];

  const logger: SourceIngestionLogger = {
    errorFields: () => globalThis.undefined,
    flush: () => {
      flushedEvents.push({
        fields: Object.fromEntries(fields.entries()),
      });
      fields.clear();
    },
    measureDuration: <TResult>(operation: () => Promise<TResult>) => operation(),
    set: (field, value) => {
      fields.set(field, value);
    },
  };

  return { logger, flushedEvents };
};

const createRetryableClassifier = (): ((error: unknown) => SourceIngestionFailureDecision) =>
  () => ({
    code: "transient_failure",
    eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
    logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
  });

describe("source ingestion widelog contract", () => {
  test("emits one isolated per-calendar wide event per source unit", async () => {
    const { logger, flushedEvents } = createCapturingLogger();

    const runtimeA: SourceIngestionRuntime = {
      dispatch: (event) => {
        if (event.type === SourceIngestionLifecycleEventType.FETCHER_RESOLVED) {
          logger.set("machine.source_ingestion_lifecycle.processed_total", 2);
        }
        return Promise.resolve(globalThis.undefined);
      },
    };

    const runtimeB: SourceIngestionRuntime = {
      dispatch: () => Promise.resolve(globalThis.undefined),
    };

    await runSourceIngestionUnit({
      classifyFailure: createRetryableClassifier(),
      executeIngest: () =>
        Promise.resolve({
          eventsAdded: 1,
          eventsRemoved: 0,
          ingestEvents: [],
        }),
      logger,
      metadata: {
        calendarId: "calendar-a",
        provider: "google",
        userId: "user-1",
      },
      runtime: runtimeA,
    });

    await runSourceIngestionUnit({
      classifyFailure: createRetryableClassifier(),
      executeIngest: () =>
        Promise.resolve({
          eventsAdded: 0,
          eventsRemoved: 1,
          ingestEvents: [],
        }),
      logger,
      metadata: {
        calendarId: "calendar-b",
        provider: "ical",
        userId: "user-1",
      },
      runtime: runtimeB,
    });

    expect(flushedEvents).toHaveLength(2);

    const [first, second] = flushedEvents;
    if (!first || !second) {
      throw new Error("Expected two flushed source-ingestion wide events");
    }

    expect(first.fields["operation.name"]).toBe("ingest-source");
    expect(first.fields["calendar_sync.id"]).toBe("google:calendar-a");
    expect(first.fields["provider.calendar_id"]).toBe("calendar-a");
    expect(first.fields["machine.source_ingestion_lifecycle.processed_total"]).toBe(2);

    expect(second.fields["operation.name"]).toBe("ingest-source");
    expect(second.fields["calendar_sync.id"]).toBe("ical:calendar-b");
    expect(second.fields["provider.calendar_id"]).toBe("calendar-b");
    expect(second.fields["machine.source_ingestion_lifecycle.processed_total"]).toBe(
      globalThis.undefined,
    );
  });
});

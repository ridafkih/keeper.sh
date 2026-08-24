import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestWideEventFields } from "@keeper.sh/calendar";

const captured = vi.hoisted(() => ({
  ingestOptions: [] as { onIngestEvent?: (event: IngestWideEventFields) => void }[],
  setCalls: [] as [string, unknown][],
}));

const INGEST_WIDE_EVENT: IngestWideEventFields = {
  "calendar.id": "source-1",
  "duration_ms": 12,
  "events.added": 0,
  "events.removed": 1,
  "operation.name": "ingest:source",
  "operation.type": "ingest",
  "outcome": "success",
  "source_events.discarded_unrepresentable": 1,
  "source_events.skipped_resources": 2,
};

vi.mock("@/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    errorFields: () => null,
    flush: () => null,
    set: (key: string, value: unknown) => {
      captured.setCalls.push([key, value]);
    },
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ingestSource: (options: { onIngestEvent?: (event: IngestWideEventFields) => void }) => {
      captured.ingestOptions.push(options);
      options.onIngestEvent?.(INGEST_WIDE_EVENT);
      return Promise.resolve({ eventsAdded: 0, eventsRemoved: 1 });
    },
  };
});

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: () => ({ fetchEvents: () => Promise.resolve({ events: [] }) }),
  interpretFullDayTimedEventsAsAllDay: (events: unknown) => events,
  persistCalendarSnapshot: () => Promise.resolve(),
  pullRemoteCalendar: () => Promise.resolve({ events: [] }),
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: { isCurrent: () => Promise.resolve(true), release: () => Promise.resolve() },
    }),
  }),
}));

vi.mock("@/context", () => ({ database: {}, premiumService: {}, redis: {} }));

vi.mock("../../src/utils/source-ingestion-ranges", () => ({
  buildSourceIngestionPlan: () => Promise.resolve({}),
  createDestinationRangesReader: () => ({}),
}));

vi.mock("../../src/utils/safe-fetch-options", () => ({ safeFetchOptions: {} }));

const SOURCE = {
  id: "source-1",
  treatFullDayTimedEventsAsAllDay: false,
  url: "https://example.com/feed.ics",
};

describe("user-triggered ICS ingestion telemetry", () => {
  beforeEach(() => {
    captured.ingestOptions = [];
    captured.setCalls = [];
  });

  it("merges the ingestion engine's discard and removal counts onto the job wide event", async () => {
    const { ingestIcsSource } = await import("../../src/utils/sources");
    const { spawnBackgroundJob } = await import("../../src/utils/background-task");

    await spawnBackgroundJob("ical-source-sync", { calendarId: SOURCE.id }, () =>
      ingestIcsSource(SOURCE as never));

    expect(captured.ingestOptions).toHaveLength(1);
    expect(captured.ingestOptions[0]?.onIngestEvent).toBeTypeOf("function");

    const fields = new Map(captured.setCalls);
    expect(fields.get("events.removed")).toBe(1);
    expect(fields.get("source_events.discarded_unrepresentable")).toBe(1);
    expect(fields.get("source_events.skipped_resources")).toBe(2);
  });

  it("leaves the background job's own outcome and timing fields to the job", async () => {
    const { ingestIcsSource } = await import("../../src/utils/sources");

    await ingestIcsSource(SOURCE as never);

    const ingestKeys = captured.setCalls.map(([key]) => key);
    expect(ingestKeys).not.toContain("operation.name");
    expect(ingestKeys).not.toContain("outcome");
    expect(ingestKeys).not.toContain("duration_ms");
  });
});

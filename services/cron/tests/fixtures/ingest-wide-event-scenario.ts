import { ingestSource } from "@keeper.sh/calendar";
import type { IngestWideEventFields } from "@keeper.sh/calendar";
import { context, destroy, widelog } from "../../src/utils/logging";
import { selectIngestWideEventFields } from "../../src/utils/ingest-wide-event";

/*
 * Mirrors `recordIngestWideEvent` in src/jobs/ingest-sources.ts, the only
 * consumer of `selectIngestWideEventFields`.
 */
const recordIngestWideEvent = (event: IngestWideEventFields): void => {
  for (const [key, value] of Object.entries(selectIngestWideEventFields(event))) {
    widelog.set(key, value);
  }
};

const ingestGoogleSourceDroppingOneEvent = (): Promise<unknown> => ingestSource({
  calendarId: "google-calendar",
  fetchEvents: () => Promise.resolve({
    changedEventIds: ["dropped-id"],
    discardedEventCounts: { outsideSyncWindow: 0, unrepresentable: 1 },
    events: [],
    isDeltaSync: true,
  }),
  flush: () => Promise.resolve(),
  onIngestEvent: recordIngestWideEvent,
  readExistingEvents: () => Promise.resolve([{
    endTime: new Date("2026-06-20T10:00:00.000Z"),
    exceptionDates: null,
    id: "state-dropped",
    recurrenceId: null,
    recurrenceRule: null,
    sourceEventId: "dropped-id",
    sourceEventUid: "dropped@example.com",
    startTime: new Date("2026-06-20T09:00:00.000Z"),
    startTimeZone: null,
  }]),
});

const ingestQuietIcsSource = (): Promise<unknown> => ingestSource({
  calendarId: "ics-calendar",
  fetchEvents: () => Promise.resolve({ events: [] }),
  flush: () => Promise.resolve(),
  onIngestEvent: recordIngestWideEvent,
  readExistingEvents: () => Promise.resolve([]),
});

const runScenario = async (mode: string): Promise<void> => {
  if (mode === "discarding-source-last") {
    await ingestQuietIcsSource();
    await ingestGoogleSourceDroppingOneEvent();
    return;
  }
  if (mode === "concurrent") {
    await Promise.all([ingestQuietIcsSource(), ingestGoogleSourceDroppingOneEvent()]);
    return;
  }
  await ingestGoogleSourceDroppingOneEvent();
  await ingestQuietIcsSource();
};

const mode = process.argv[2] ?? "discarding-source-first";

await context(async () => {
  widelog.set("operation.name", "ingest-sources");
  widelog.set("operation.type", "job");
  await runScenario(mode);
  widelog.set("outcome", "success");
  widelog.flush();
});
await destroy();

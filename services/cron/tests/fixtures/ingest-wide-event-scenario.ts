import { ingestSource } from "@keeper.sh/calendar";
import type { IngestWideEventFields } from "@keeper.sh/calendar";
import { context, destroy, widelog } from "../../src/utils/logging";
import { selectIngestWideEventFields } from "../../src/utils/ingest-wide-event";

// Mirrors `recordIngestWideEvent` in src/jobs/ingest-sources.ts.
const recordIngestWideEvent = (event: IngestWideEventFields): void => {
  for (const [key, value] of Object.entries(selectIngestWideEventFields(event))) {
    widelog.set(key, value);
  }
};

// Mirrors the per-source wide event src/jobs/ingest-sources.ts opens.
const withSourceWideEvent = (
  provider: string,
  calendarId: string,
  ingest: () => Promise<unknown>,
): Promise<void> => context(async () => {
  widelog.set("operation.name", "ingest-source");
  widelog.set("operation.type", "job");
  widelog.set("sync.direction", "ingest");
  widelog.set("provider.name", provider);
  widelog.set("provider.calendar_id", calendarId);
  try {
    await ingest();
    widelog.set("outcome", "success");
  } catch (error) {
    widelog.set("outcome", "error");
    widelog.errorFields(error, { slug: "unclassified" });
    throw error;
  } finally {
    widelog.flush();
  }
});

const ingestGoogleSourceDroppingOneEvent = (): Promise<void> =>
  withSourceWideEvent("google", "google-calendar", () => ingestSource({
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
  }));

const ingestQuietIcsSource = (): Promise<void> =>
  withSourceWideEvent("ical", "ics-calendar", () => ingestSource({
    calendarId: "ics-calendar",
    fetchEvents: () => Promise.resolve({ events: [] }),
    flush: () => Promise.resolve(),
    onIngestEvent: recordIngestWideEvent,
    readExistingEvents: () => Promise.resolve([]),
  }));

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

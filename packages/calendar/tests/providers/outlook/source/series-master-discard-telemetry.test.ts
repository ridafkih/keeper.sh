import { afterEach, describe, expect, it } from "vitest";
import { ingestSource } from "../../../../src/core/sync-engine/ingest";
import type {
  IngestWideEventFields,
  IngestionChanges,
} from "../../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../../src/core/source/stored-event-state";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);
const CALENDAR_ID = "outlook-calendar";

const SERIES_MASTER = {
  id: "master-1",
  iCalUId: "weekly-standup@example.com",
  type: "seriesMaster",
  subject: "Weekly standup",
  start: { dateTime: "2026-06-20T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-20T10:00:00.0000000", timeZone: "UTC" },
};

const SINGLE_EVENT = {
  id: "single-1",
  iCalUId: "lunch@example.com",
  type: "singleInstance",
  subject: "Lunch",
  start: { dateTime: "2026-06-21T12:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-21T13:00:00.0000000", timeZone: "UTC" },
};

const originalFetch = globalThis.fetch;

const respondByUrl = (responder: (url: string) => unknown): void => {
  const stub = (input: string | URL | Request): Promise<Response> =>
    Promise.resolve(Response.json(responder(String(input))));
  stub.preconnect = originalFetch.preconnect;
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
};

const storedEvent = (
  overrides: Partial<StoredSourceEventState> & Pick<StoredSourceEventState, "id">,
): StoredSourceEventState => ({
  endTime: new Date("2026-06-20T10:00:00.000Z"),
  exceptionDates: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventId: null,
  sourceEventUid: null,
  startTime: new Date("2026-06-20T09:00:00.000Z"),
  startTimeZone: null,
  ...overrides,
});

const DISCARD_KEYS = [
  "source_events.discarded_outside_window",
  "source_events.discarded_unrepresentable",
  "source_events.skipped_resources",
  "source_events.skipped_self_authored",
  "source_events.unsupported_count",
];

const discardTotal = (wideEvent: IngestWideEventFields): number => {
  let total = 0;
  for (const key of DISCARD_KEYS) {
    const value = wideEvent[key];
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
};

const runIngest = async (
  stored: StoredSourceEventState[],
): Promise<{ changes: IngestionChanges[]; wideEvent: IngestWideEventFields }> => {
  const fetcher = createOutlookSourceFetcher({
    accessToken: "token",
    calendarId: CALENDAR_ID,
    externalCalendarId: "primary",
    plan: PLAN,
    syncToken: null,
  });
  const changes: IngestionChanges[] = [];
  let wideEvent: IngestWideEventFields = {};
  let remaining = stored;

  await ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents: () => fetcher.fetchEvents(),
    flush: (change) => {
      changes.push(change);
      const deleted = new Set(change.deletes);
      remaining = remaining.filter((event) => !deleted.has(event.id));
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve(remaining),
  });

  return { changes, wideEvent };
};

describe("Outlook series master expansion discards", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts a series master whose instance expansion came back empty", async () => {
    respondByUrl((url) => {
      if (url.includes("/instances")) {
        return { value: [] };
      }
      return {
        value: [SERIES_MASTER, SINGLE_EVENT],
        "@odata.deltaLink": "https://graph.microsoft.com/delta-token",
      };
    });

    const run = await runIngest([
      storedEvent({
        id: "state-master",
        sourceEventId: "master-1",
        sourceEventUid: "weekly-standup@example.com",
      }),
      storedEvent({
        endTime: new Date("2026-06-21T13:00:00.000Z"),
        id: "state-single",
        sourceEventId: "single-1",
        sourceEventUid: "lunch@example.com",
        startTime: new Date("2026-06-21T12:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-master"]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("reports nothing discarded when the expansion returns the occurrence", async () => {
    respondByUrl((url) => {
      if (url.includes("/instances")) {
        return {
          value: [{
            ...SERIES_MASTER,
            id: "master-1",
            type: "occurrence",
          }],
        };
      }
      return {
        value: [SERIES_MASTER, SINGLE_EVENT],
        "@odata.deltaLink": "https://graph.microsoft.com/delta-token",
      };
    });

    const run = await runIngest([
      storedEvent({
        id: "state-master",
        sourceEventId: "master-1",
        sourceEventUid: "weekly-standup@example.com",
      }),
      storedEvent({
        endTime: new Date("2026-06-21T13:00:00.000Z"),
        id: "state-single",
        sourceEventId: "single-1",
        sourceEventUid: "lunch@example.com",
        startTime: new Date("2026-06-21T12:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes ?? []).toEqual([]);
    expect(discardTotal(run.wideEvent)).toBe(0);
  });
});

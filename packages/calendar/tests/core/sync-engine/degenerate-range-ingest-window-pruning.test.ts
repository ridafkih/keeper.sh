import { describe, expect, it } from "vitest";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { SourceEvent } from "../../../src/core/types";
import { overlapsTimeWindow } from "../../../src/core/events/time-range";

const SYNC_WINDOW = {
  timeMax: new Date("2027-04-08T00:00:00.000Z"),
  timeMin: new Date("2027-03-08T00:00:00.000Z"),
};

interface StoredRow {
  availability: string | null;
  description: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  location: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventId: string | null;
  sourceEventType: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
  title: string | null;
}

const toStoredRow = (id: string, event: SourceEvent): StoredRow => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: null,
  id,
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: null,
  title: event.title ?? null,
});

const makeEvent = (uid: string, start: string, end: string): SourceEvent => ({
  endTime: new Date(end),
  isAllDay: false,
  startTime: new Date(start),
  title: `Event ${uid}`,
  uid,
});

const runDeltaWithNoReportedChanges = async (
  rows: StoredRow[],
): Promise<IngestionChanges | null> => {
  const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
  let flushed: IngestionChanges | null = null;

  await ingestSource({
    calendarId: "cal-1",
    fetchEvents: () => Promise.resolve({
      cancelledEventIds: [],
      changedEventIds: [],
      events: [],
      isDeltaSync: true,
      syncWindow: SYNC_WINDOW,
    }),
    flush: (changes) => {
      flushed = changes;
      return Promise.resolve();
    },
    readExistingEvents: () => Promise.resolve(rows),
  });

  return flushed;
};

const deletedIds = (changes: IngestionChanges | null): string[] => changes?.deletes ?? [];

describe("delta ingest window pruning of degenerate ranges", () => {
  it("keeps a zero-duration stored event sitting exactly on the window's lower edge", async () => {
    const edgeEvent = makeEvent(
      "edge",
      "2027-03-08T00:00:00.000Z",
      "2027-03-08T00:00:00.000Z",
    );

    expect(
      overlapsTimeWindow(edgeEvent, SYNC_WINDOW.timeMin, SYNC_WINDOW.timeMax),
    ).toBe(true);

    const flushed = await runDeltaWithNoReportedChanges([
      toStoredRow("edge-state", edgeEvent),
    ]);

    expect(deletedIds(flushed)).toEqual([]);
  });

  it("keeps an inverted stored event whose start sits inside the window", async () => {
    const invertedEvent = makeEvent(
      "inverted",
      "2027-03-20T16:00:00.000Z",
      "2027-03-05T16:00:00.000Z",
    );

    expect(
      overlapsTimeWindow(invertedEvent, SYNC_WINDOW.timeMin, SYNC_WINDOW.timeMax),
    ).toBe(true);

    const flushed = await runDeltaWithNoReportedChanges([
      toStoredRow("inverted-state", invertedEvent),
    ]);

    expect(deletedIds(flushed)).toEqual([]);
  });

  it("still prunes a stored event whose whole range predates the window", async () => {
    const historicalEvent = makeEvent(
      "historical",
      "2025-01-01T09:00:00.000Z",
      "2025-01-01T10:00:00.000Z",
    );

    expect(
      overlapsTimeWindow(historicalEvent, SYNC_WINDOW.timeMin, SYNC_WINDOW.timeMax),
    ).toBe(false);

    const flushed = await runDeltaWithNoReportedChanges([
      toStoredRow("historical-state", historicalEvent),
    ]);

    expect(deletedIds(flushed)).toEqual(["historical-state"]);
  });

  it("still prunes a zero-duration stored event sitting on the window's upper edge", async () => {
    const upperEdgeEvent = makeEvent(
      "upper-edge",
      "2027-04-08T00:00:00.000Z",
      "2027-04-08T00:00:00.000Z",
    );

    expect(
      overlapsTimeWindow(upperEdgeEvent, SYNC_WINDOW.timeMin, SYNC_WINDOW.timeMax),
    ).toBe(false);

    const flushed = await runDeltaWithNoReportedChanges([
      toStoredRow("upper-edge-state", upperEdgeEvent),
    ]);

    expect(deletedIds(flushed)).toEqual(["upper-edge-state"]);
  });

  it("agrees with the shared window predicate on every stored row it judges", async () => {
    const rows = [
      makeEvent("edge-zero", "2027-03-08T00:00:00.000Z", "2027-03-08T00:00:00.000Z"),
      makeEvent("inverted-inside", "2027-03-20T16:00:00.000Z", "2027-03-05T16:00:00.000Z"),
      makeEvent("inverted-outside", "2027-02-20T16:00:00.000Z", "2027-02-05T16:00:00.000Z"),
      makeEvent("normal-inside", "2027-03-15T09:00:00.000Z", "2027-03-15T10:00:00.000Z"),
      makeEvent("normal-before", "2027-03-07T09:00:00.000Z", "2027-03-07T10:00:00.000Z"),
      makeEvent("normal-touching-min", "2027-03-07T23:00:00.000Z", "2027-03-08T00:00:00.000Z"),
      makeEvent("zero-inside", "2027-03-15T09:00:00.000Z", "2027-03-15T09:00:00.000Z"),
    ].map((event) => toStoredRow(`${event.uid}-state`, event));

    const flushed = await runDeltaWithNoReportedChanges(rows);
    const pruned = new Set(deletedIds(flushed));

    const disagreements = rows
      .filter((row) => {
        const insideWindow = overlapsTimeWindow(
          row,
          SYNC_WINDOW.timeMin,
          SYNC_WINDOW.timeMax,
        );
        return insideWindow === pruned.has(row.id);
      })
      .map((row) => row.id);

    expect(disagreements).toEqual([]);
  });

  it("does not oscillate across the full-sync / delta-sync cycle", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const edgeEvent = makeEvent(
      "edge",
      "2027-03-08T00:00:00.000Z",
      "2027-03-08T00:00:00.000Z",
    );
    let rows: StoredRow[] = [];
    let nextId = 0;
    const rowCountAfterEachRun: number[] = [];

    const reportedEvents = (isDeltaSync: boolean): SourceEvent[] => {
      if (isDeltaSync) {
        return [];
      }
      return [edgeEvent];
    };

    const runOnce = (isDeltaSync: boolean) => ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        cancelledEventIds: [],
        changedEventIds: [],
        events: reportedEvents(isDeltaSync),
        isDeltaSync,
        syncWindow: SYNC_WINDOW,
      }),
      flush: (changes) => {
        const removed = new Set(changes.deletes);
        rows = rows.filter((row) => !removed.has(row.id));
        for (const insert of changes.inserts) {
          nextId += 1;
          rows = [...rows, toStoredRow(`state-${nextId}`, insert)];
        }
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve(rows),
    });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await runOnce(false);
      rowCountAfterEachRun.push(rows.length);
      await runOnce(true);
      rowCountAfterEachRun.push(rows.length);
    }

    expect(rowCountAfterEachRun).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

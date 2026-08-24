import { describe, expect, it } from "vitest";
import { filterSourceEventsToSyncWindow } from "../../../src/core/source/sync-diagnostics";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";

const WINDOW = {
  timeMin: new Date("2026-06-01T00:00:00.000Z"),
  timeMax: new Date("2026-08-01T00:00:00.000Z"),
};

const storedIdFor = (event: SourceEvent): string => event.uid;

const toStored = (event: SourceEvent): StoredSourceEventState => ({
  availability: null,
  description: null,
  endTime: event.endTime,
  exceptionDates: null,
  id: storedIdFor(event),
  isAllDay: null,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: null,
  title: event.title ?? null,
});

const event = (uid: string, start: string, end: string): SourceEvent => ({
  endTime: new Date(end),
  sourceEventId: uid,
  startTime: new Date(start),
  title: uid,
  uid,
});

const runDeltaRound = async (
  initialStore: readonly StoredSourceEventState[],
  candidates: SourceEvent[],
): Promise<{ round: { added: number; removed: number }; store: StoredSourceEventState[] }> => {
  let store = [...initialStore];

  const result = await ingestSource({
    calendarId: "boundary-probe",
    fetchEvents: () => {
      const { events } = filterSourceEventsToSyncWindow(candidates, WINDOW);
      return Promise.resolve({
        changedEventIds: events.map((entry) => entry.sourceEventId ?? entry.uid),
        events,
        isDeltaSync: true,
        syncWindow: WINDOW,
      });
    },
    flush: (changes) => {
      const deleted = new Set(changes.deletes);
      store = [
        ...store.filter((entry) => !deleted.has(entry.id)),
        ...changes.inserts.map((insert) => toStored(insert)),
      ];
      return Promise.resolve();
    },
    readExistingEvents: () => Promise.resolve([...store]),
  });

  return {
    round: { added: result.eventsAdded, removed: result.eventsRemoved },
    store,
  };
};

const runDeltaRounds = async (
  rounds: number,
  candidates: SourceEvent[],
  initialStore: StoredSourceEventState[],
): Promise<{ added: number; removed: number }[]> => {
  let store = [...initialStore];
  const history: { added: number; removed: number }[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const outcome = await runDeltaRound(store, candidates);
    ({ store } = outcome);
    history.push(outcome.round);
  }

  return history;
};

const boundaryCases: { name: string; event: SourceEvent }[] = [
  { event: event("ends-at-time-min", "2026-05-31T23:00:00Z", "2026-06-01T00:00:00Z"), name: "ends exactly at timeMin" },
  { event: event("starts-at-time-max", "2026-08-01T00:00:00Z", "2026-08-01T01:00:00Z"), name: "starts exactly at timeMax" },
  { event: event("zero-length-at-time-min", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"), name: "zero-length at timeMin" },
  { event: event("zero-length-inside", "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z"), name: "zero-length inside window" },
  { event: event("straddles-time-min", "2026-05-31T23:00:00Z", "2026-06-01T01:00:00Z"), name: "straddles timeMin" },
  { event: event("straddles-time-max", "2026-07-31T23:00:00Z", "2026-08-01T01:00:00Z"), name: "straddles timeMax" },
  { event: event("well-inside", "2026-07-01T09:00:00Z", "2026-07-01T10:00:00Z"), name: "well inside window" },
];

describe("window boundary agreement between adapter filter and delta pruner", () => {
  for (const testCase of boundaryCases) {
    it(`settles for an event that ${testCase.name}`, async () => {
      const kept = filterSourceEventsToSyncWindow([testCase.event], WINDOW).events.length > 0;
      const history = await runDeltaRounds(6, [testCase.event], []);
      const trace = history
        .map((round) => `${String(round.added)}/${String(round.removed)}`)
        .join(" ");

      const settled = history.slice(2);
      expect(
        settled.every((round) => round.added === 0 && round.removed === 0),
        `kept by adapter filter: ${String(kept)}; add/remove per round: ${trace}`,
      ).toBe(true);
    });
  }

  it("settles when every boundary case is ingested together", async () => {
    const candidates = boundaryCases.map((testCase) => testCase.event);
    const history = await runDeltaRounds(8, candidates, []);
    const trace = history
      .map((round) => `${String(round.added)}/${String(round.removed)}`)
      .join(" ");

    expect(
      history.slice(2).every((round) => round.added === 0 && round.removed === 0),
      `add/remove per round: ${trace}`,
    ).toBe(true);
  });
});

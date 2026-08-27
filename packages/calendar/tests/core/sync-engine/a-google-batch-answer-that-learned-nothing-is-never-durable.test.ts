import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createGoogleSyncProvider } from "../../../src/providers/google/destination/provider";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const FAILURES_BEFORE_REPLACEMENT = 3;
const GOOGLE_EVENT_ID = "google-event-id-abc123";
const SECOND_GOOGLE_EVENT_ID = "google-event-id-def456";
const RESPONSE_BOUNDARY = "batch_synthetic_boundary";

const movedMeeting: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "ev-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Weekly standup, moved",
};

const secondMeeting: MaterializedSyncableEvent = {
  ...movedMeeting,
  id: "ev-2",
  sourceEventUid: "source-event-uid-2",
  summary: "Design review, moved",
};

const makeMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: GOOGLE_EVENT_ID,
  destinationEventUid: "keeper-uid-1",
  endTime: movedMeeting.endTime,
  eventStateId: movedMeeting.id,
  id: "map-1",
  sourceCalendarId: "source-calendar-id",
  startTime: movedMeeting.startTime,
  syncEventHash: "stale-hash",
  syncEventId: movedMeeting.id,
});

const makeReplacement = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: movedMeeting,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const missingBatchResponse = (): PushResult => ({
  error: "Missing batch response",
  errorType: "GoogleBatchProtocolError",
  success: false,
});

const zeroStatusResponse = (): PushResult => ({
  error: `Batch sub-request failed with status ${0}`,
  errorType: "GoogleCalendarApiError",
  statusCode: 0,
  success: false,
});

interface CycleRun {
  cyclesRun: number;
  recordedCounters: number[];
  deleteCalls: string[][];
  pushedEventIds: string[];
  deletedMappingIds: string[];
}

const createGoogleShapedProvider = (
  learnedNothing: () => PushResult,
  deleteCalls: string[][],
  pushedEventIds: string[],
): CalendarSyncProvider => ({
  deleteEvents: (eventIds) => {
    deleteCalls.push([...eventIds]);
    return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
  },
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: (events) => {
    for (const event of events) {
      pushedEventIds.push(event.id);
    }
    return Promise.resolve(events.map(() => learnedNothing()));
  },
  updateEvents: (updates) => Promise.resolve(updates.map(() => learnedNothing())),
});

const isRecordedFailureCount = (counter: number | undefined): counter is number =>
  typeof counter === "number";

const runCycles = async (learnedNothing: () => PushResult, cycles: number): Promise<CycleRun> => {
  const deleteCalls: string[][] = [];
  const pushedEventIds: string[] = [];
  const deletedMappingIds: string[] = [];
  const recordedCounters: number[] = [];
  const provider = createGoogleShapedProvider(learnedNothing, deleteCalls, pushedEventIds);
  let mapping: EventMapping | null = makeMapping();
  let cyclesRun = 0;

  for (let cycle = 0; cycle < cycles; cycle++) {
    cyclesRun++;
    if (!mapping) {
      continue;
    }

    const outcome = await executeRemoteOperations(
      [makeReplacement(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );

    deletedMappingIds.push(...outcome.changes.deletes);

    const mappingId = mapping.id;
    const carried = (outcome.changes.updates ?? []).find((update) => update.id === mappingId);
    const carriedCount = carried?.consecutiveUpdateFailures;
    if (isRecordedFailureCount(carriedCount)) {
      recordedCounters.push(carriedCount);
    }

    if (outcome.changes.deletes.includes(mappingId)) {
      mapping = null;
      continue;
    }
    if (carried) {
      mapping = { ...mapping, ...carried, id: mappingId } as EventMapping;
    }
  }

  return { cyclesRun, deleteCalls, deletedMappingIds, pushedEventIds, recordedCounters };
};

const learnedNothingShapes = [
  { emit: missingBatchResponse, label: "a sub-response the batch never returned" },
  { emit: zeroStatusResponse, label: "a part carrying no HTTP status line at all" },
];

const genuineDestinationRefusals = [
  { label: "503", statusCode: 503 },
  { label: "429", statusCode: 429 },
];

const buildSubResponsePart = (contentId: string, eventId: string): string => {
  const body = JSON.stringify({
    end: { dateTime: "2026-03-15T10:00:00Z" },
    id: eventId,
    start: { dateTime: "2026-03-15T09:00:00Z" },
    summary: "Weekly standup, moved",
  });
  return [
    `--${RESPONSE_BOUNDARY}`,
    "Content-Type: application/http",
    `Content-ID: <${contentId}>`,
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: application/json",
    "",
    body,
  ].join("\r\n");
};

const stubBatchFetchReturning = (contentId: string, eventId: string): (() => void) => {
  const originalFetch = globalThis.fetch;
  const responseText = `${buildSubResponsePart(contentId, eventId)}\r\n--${RESPONSE_BOUNDARY}--\r\n`;

  globalThis.fetch = ((_input: unknown, _init?: RequestInit) => Promise.resolve(new Response(responseText, {
    headers: { "Content-Type": `multipart/mixed; boundary=${RESPONSE_BOUNDARY}` },
    status: 200,
  }))) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
};

const updateTwoEventsThroughRealGoogle = async (
  contentId: string,
  eventId: string,
): Promise<PushResult[]> => {
  const provider = createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "cal-1",
    externalCalendarId: "primary",
    refreshToken: "test-refresh",
    userId: "user-1",
  });

  const restoreFetch = stubBatchFetchReturning(contentId, eventId);
  try {
    return await provider.updateEvents?.([
      { deleteId: GOOGLE_EVENT_ID, event: movedMeeting },
      { deleteId: SECOND_GOOGLE_EVENT_ID, event: secondMeeting },
    ]) ?? [];
  } finally {
    restoreFetch();
  }
};

describe("a google batch answer that learned nothing is never durable evidence", () => {
  for (const shape of learnedNothingShapes) {
    it(`never deletes the customer's google event after three cycles of ${shape.label}`, async () => {
      const run = await runCycles(shape.emit, FAILURES_BEFORE_REPLACEMENT);

      expect(run.deleteCalls).toEqual([]);
      expect(run.deletedMappingIds).toEqual([]);
      expect(run.pushedEventIds).toEqual([]);
    });

    it(`accumulates no durable evidence from ${shape.label}`, async () => {
      const run = await runCycles(shape.emit, FAILURES_BEFORE_REPLACEMENT + 1);

      expect(run.cyclesRun).toBe(FAILURES_BEFORE_REPLACEMENT + 1);
      expect(run.recordedCounters).toEqual([]);
    });
  }

  for (const refusal of genuineDestinationRefusals) {
    it(`still never promotes a ${refusal.label} the destination really answered`, async () => {
      const emit = (): PushResult => ({
        error: `Batch sub-request failed with status ${refusal.statusCode}`,
        errorType: "GoogleCalendarApiError",
        statusCode: refusal.statusCode,
        success: false,
      });

      const run = await runCycles(emit, FAILURES_BEFORE_REPLACEMENT);

      expect(run.deleteCalls).toEqual([]);
      expect(run.recordedCounters).toEqual([]);
    });
  }
});

describe("a real google batch response never lets one index answer for another", () => {
  it("reports an unanswered zero status for the index the batch omitted", async () => {
    const results = await updateTwoEventsThroughRealGoogle("response-item-0", GOOGLE_EVENT_ID);

    expect(results[0]).toMatchObject({ success: true });
    expect(results[1]).toMatchObject(zeroStatusResponse());
    expect(results[1]).toMatchObject({ destinationAnswer: "unanswered" });
    expect(results[1]).not.toHaveProperty("deleteId");
  });

  it("reports a zero status for the index the renumbered parts skipped", async () => {
    const results = await updateTwoEventsThroughRealGoogle("response-item-1", SECOND_GOOGLE_EVENT_ID);

    expect(results[0]).toMatchObject({
      errorType: "GoogleCalendarApiError",
      statusCode: 0,
      success: false,
    });
    expect(results[1]).toMatchObject({ success: true });
  });
});

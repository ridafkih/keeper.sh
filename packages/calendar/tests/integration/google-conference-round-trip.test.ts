import { describe, expect, it, vi } from "vitest";
import {
  fetchCalendarEvents,
  parseGoogleEvents,
} from "../../src/providers/google/source/utils/fetch-events";
import { serializeGoogleEvent } from "../../src/providers/google/destination/serialize-event";
import { buildSourceEventsToAdd } from "../../src/core/source/event-diff";
import { buildEventStateInsertRow } from "../../src/core/source/write-event-states";
import { parseStoredSourceEventStates } from "../../src/core/source/stored-event-state";
import { resolveConference } from "../../src/core/events/events";
import { createSyncEventContentHash } from "../../src/core/events/content-hash";
import type { GoogleCalendarEvent } from "../../src/providers/google/source/types";
import type { StoredSourceEventState } from "../../src/core/source/stored-event-state";
import type { MaterializedSyncableEvent, SourceEvent } from "../../src/core/types";

const MEET_URI = "https://meet.google.com/abc-defg-hij";
const SOURCE_CALENDAR_ID = "source-calendar";
const EVENT_STATE_ID = "event-state-1";

const sourceEvent = (overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: "provider-event-id",
  iCalUID: "source-event@google.com",
  summary: "Weekly sync",
  start: { dateTime: "2026-09-10T10:00:00Z" },
  end: { dateTime: "2026-09-10T11:00:00Z" },
  updated: "2026-09-01T00:00:00Z",
  ...overrides,
});

const MEET_CONFERENCE_DATA: GoogleCalendarEvent["conferenceData"] = {
  conferenceId: "abc-defg-hij",
  conferenceSolution: { key: { type: "hangoutsMeet" } },
  entryPoints: [
    { entryPointType: "video", uri: MEET_URI },
    { entryPointType: "phone", label: "+1 555-0100", pin: "123456", uri: "tel:+15550100" },
  ],
};

/* One row of event_states, as the ingest writes it and the destination read sees it. */
const storedOrNone = (stored: StoredSourceEventState | null): StoredSourceEventState[] => {
  if (!stored) {
    return [];
  }
  return [stored];
};

const toStoredRow = (event: SourceEvent): StoredSourceEventState => {
  const row = buildEventStateInsertRow(SOURCE_CALENDAR_ID, event);
  return {
    conference: row.conference ?? null,
    description: row.description ?? null,
    endTime: row.endTime,
    exceptionDates: row.exceptionDates ?? null,
    id: EVENT_STATE_ID,
    recurrenceId: row.recurrenceId ?? null,
    recurrenceRule: row.recurrenceRule ?? null,
    sourceEventId: row.sourceEventId ?? null,
    sourceEventUid: row.sourceEventUid ?? null,
    startTime: row.startTime,
    startTimeZone: row.startTimeZone ?? null,
    title: row.title ?? null,
  };
};

const toDestinationEvent = (
  row: StoredSourceEventState,
  excludeEventDescription = false,
): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Work",
  calendarUrl: null,
  conference: resolveConference(excludeEventDescription, row.conference ?? null),
  endTime: row.endTime,
  id: row.id,
  sourceEventUid: row.sourceEventUid ?? "",
  startTime: row.startTime,
  summary: row.title ?? "Busy",
});

/* One ingest tick: what the source reports, diffed against what is already stored. */
const ingest = (
  stored: StoredSourceEventState | null,
  incoming: GoogleCalendarEvent,
  isDeltaSync: boolean,
): { row: StoredSourceEventState; rewritten: boolean } => {
  const existing = parseStoredSourceEventStates(storedOrNone(stored));
  const parsed = parseGoogleEvents([incoming]).map((event): SourceEvent => ({
    conference: event.conference,
    description: event.description,
    endTime: event.endTime,
    sourceEventId: event.sourceEventId,
    startTime: event.startTime,
    title: event.title,
    uid: event.uid,
  }));
  const toAdd = buildSourceEventsToAdd(existing, parsed, { isDeltaSync });
  const [rewrite] = toAdd;
  if (!rewrite) {
    if (!stored) {
      throw new Error("Nothing stored and nothing to add");
    }
    return { row: stored, rewritten: false };
  }
  return { row: toStoredRow(rewrite), rewritten: true };
};

describe("a Google Meet travelling from one Google calendar to another", () => {
  it("reaches the destination write as the source's own conference", () => {
    const { row } = ingest(null, sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }), false);
    const resource = serializeGoogleEvent(toDestinationEvent(row), "destination-uid");

    expect(resource?.conferenceData).toEqual({
      conferenceSolution: { key: { type: "hangoutsMeet" } },
      conferenceId: "abc-defg-hij",
      entryPoints: [
        { entryPointType: "video", uri: MEET_URI },
        { entryPointType: "phone", uri: "tel:+15550100", label: "+1 555-0100", pin: "123456" },
      ],
    });
  });

  it("writes nothing conference-shaped for a source event without a meeting", () => {
    const { row } = ingest(null, sourceEvent(), false);

    expect(row.conference).toBeNull();
    expect(serializeGoogleEvent(toDestinationEvent(row), "destination-uid"))
      .not.toHaveProperty("conferenceData");
  });

  it("carries a meeting added between incremental ticks through to the destination", () => {
    const first = ingest(null, sourceEvent(), true);
    expect(first.row.conference).toBeNull();

    const second = ingest(
      first.row,
      sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }),
      true,
    );

    expect(second.rewritten).toBe(true);
    expect(serializeGoogleEvent(toDestinationEvent(second.row), "destination-uid")?.conferenceData)
      .toBeDefined();
    /* The mapping's stored hash moves, so the mirror is re-pushed rather than left stale. */
    expect(createSyncEventContentHash(toDestinationEvent(second.row)))
      .not.toBe(createSyncEventContentHash(toDestinationEvent(first.row)));
  });

  it("drops the meeting from the destination write once the source loses it", () => {
    const withMeeting = ingest(
      null,
      sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }),
      true,
    );
    const without = ingest(withMeeting.row, sourceEvent(), true);

    expect(without.rewritten).toBe(true);
    expect(without.row.conference).toBeNull();
    expect(serializeGoogleEvent(toDestinationEvent(without.row), "destination-uid"))
      .not.toHaveProperty("conferenceData");
  });

  it("leaves an unchanged incremental tick alone", () => {
    const first = ingest(null, sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }), true);
    const second = ingest(
      first.row,
      sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }),
      true,
    );

    expect(second.rewritten).toBe(false);
    expect(second.row.conference).toBe(first.row.conference);
  });

  it("withholds the meeting from a destination that mirrors busy blocks only", () => {
    const { row } = ingest(null, sourceEvent({ conferenceData: MEET_CONFERENCE_DATA }), false);

    expect(serializeGoogleEvent(toDestinationEvent(row, true), "destination-uid"))
      .not.toHaveProperty("conferenceData");
  });
});

describe("reading a conference through a temporary Google failure", () => {
  it("keeps the meeting after a rate-limited page is retried", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;

    const listBody = {
      items: [sourceEvent({ conferenceData: MEET_CONFERENCE_DATA })],
      nextSyncToken: "sync-token",
    };

    globalThis.fetch = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(Response.json(
          { error: { code: 429, message: "rateLimitExceeded" } },
          { status: 429 },
        ));
      }
      return Promise.resolve(Response.json(listBody, { status: 200 }));
    }) as unknown as typeof fetch;

    vi.useFakeTimers();
    try {
      const pending = fetchCalendarEvents({ accessToken: "token", calendarId: "primary" });
      await vi.waitFor(() => {
        expect(calls).toBe(1);
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(calls).toBe(2);
      const [parsed] = parseGoogleEvents(result.events);
      expect(parsed?.conference?.entryPoints).toEqual([
        { type: "video", uri: MEET_URI },
        { type: "phone", uri: "tel:+15550100", label: "+1 555-0100", pin: "123456" },
      ]);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    }
  });
});

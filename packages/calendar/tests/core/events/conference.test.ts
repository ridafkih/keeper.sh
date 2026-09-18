import { describe, expect, it } from "vitest";
import {
  createEventConference,
  getConferenceVideoUri,
  isGoogleMeetVideoUri,
  parseStoredEventConference,
  serializeEventConference,
} from "../../../src/core/events/conference";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import { buildSourceEventIdentityKey } from "../../../src/core/source/event-diff";
import { buildEventStateInsertRow } from "../../../src/core/source/write-event-states";
import { resolveConference } from "../../../src/core/events/events";
import type { EventConference } from "../../../src/core/events/conference";
import type { SyncableEvent } from "../../../src/core/types";

const MEET_URI = "https://meet.google.com/abc-defg-hij";

const conference: EventConference = {
  solution: "hangoutsMeet",
  conferenceId: "abc-defg-hij",
  entryPoints: [
    { type: "video", uri: MEET_URI },
    { type: "phone", uri: "tel:+15550100", pin: "123456" },
  ],
};

const baseEvent: SyncableEvent = {
  calendarId: "calendar-id",
  calendarName: "Work",
  calendarUrl: null,
  endTime: new Date("2026-09-10T11:00:00.000Z"),
  id: "event-id",
  sourceEventUid: "source-event@google.com",
  startTime: new Date("2026-09-10T10:00:00.000Z"),
  summary: "Weekly sync",
};

const identityKey = (overrides: { conference?: EventConference } = {}): string =>
  buildSourceEventIdentityKey({
    endTime: baseEvent.endTime,
    sourceEventId: "provider-event-id",
    sourceEventInstanceKey: "instance",
    sourceEventUid: baseEvent.sourceEventUid,
    startTime: baseEvent.startTime,
    title: baseEvent.summary,
    ...overrides,
  });

describe("validating a Google Meet join link", () => {
  it.each([
    MEET_URI,
    "https://meet.google.com/lookup/abcdefghij",
  ])("accepts %s", (uri) => {
    expect(isGoogleMeetVideoUri(uri)).toBe(true);
  });

  it.each([
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com",
    "https://meet.google.com.evil.example/abc-defg-hij",
    "https://evil.example/meet.google.com/abc",
    "ftp://meet.google.com/abc-defg-hij",
    "",
  ])("rejects %s", (uri) => {
    expect(isGoogleMeetVideoUri(uri)).toBe(false);
  });
});

describe("building a conference", () => {
  it("refuses one whose video entry point is not a Meet link", () => {
    expect(createEventConference([{ type: "video", uri: "https://example.zoom.us/j/1" }]))
      .toBeUndefined();
  });

  it("refuses one that has no video entry point at all", () => {
    expect(createEventConference([{ type: "phone", uri: "tel:+15550100" }])).toBeUndefined();
  });

  it("drops an unusable entry point but keeps the meeting", () => {
    expect(createEventConference([
      { type: "video", uri: MEET_URI },
      { type: "phone", uri: "https://not-a-phone.example" },
    ])?.entryPoints).toEqual([{ type: "video", uri: MEET_URI }]);
  });

  it("exposes the video link as the join URL", () => {
    expect(getConferenceVideoUri(conference)).toBe(MEET_URI);
  });
});

describe("storing a conference", () => {
  it("survives a round trip through the stored column", () => {
    const stored = serializeEventConference(conference);
    expect(typeof stored).toBe("string");
    expect(parseStoredEventConference(stored)).toEqual(conference);
  });

  it("stores nothing for an event with no meeting", () => {
    expect(serializeEventConference(globalThis.undefined)).toBeNull();
    expect(buildEventStateInsertRow("calendar-id", {
      endTime: baseEvent.endTime,
      startTime: baseEvent.startTime,
      uid: baseEvent.sourceEventUid,
    }).conference).toBeNull();
  });

  it("writes the serialized conference onto the event state row", () => {
    expect(buildEventStateInsertRow("calendar-id", {
      conference,
      endTime: baseEvent.endTime,
      startTime: baseEvent.startTime,
      uid: baseEvent.sourceEventUid,
    }).conference).toBe(serializeEventConference(conference));
  });

  it.each([
    null,
    "",
    "{not json",
    JSON.stringify({ solution: "addOn", entryPoints: [{ type: "video", uri: MEET_URI }] }),
    JSON.stringify({ solution: "hangoutsMeet", entryPoints: [{ type: "video", uri: "https://evil.example/x" }] }),
    JSON.stringify({ solution: "hangoutsMeet", entryPoints: [] }),
  ])("degrades a stored value it cannot vouch for to no conference: %s", (stored) => {
    expect(parseStoredEventConference(stored)).toBeUndefined();
  });
});

describe("noticing a conference change", () => {
  it("leaves the hash of an event without a meeting untouched", () => {
    /*
     * Pinned rather than computed: every mapping already stores this value, and a
     * shift here would re-push the whole fleet to change nothing.
     */
    expect(createSyncEventContentHash(baseEvent))
      .toBe("bd936c0e2854834e82bf54e26913890daaaaac4189c2587811008bc901c6d110");
  });

  it("changes the hash when a meeting is added, and restores it when removed", () => {
    const without = createSyncEventContentHash(baseEvent);
    const withMeeting = createSyncEventContentHash({ ...baseEvent, conference });
    const removed = createSyncEventContentHash({ ...baseEvent, conference: globalThis.undefined });

    expect(withMeeting).not.toBe(without);
    expect(removed).toBe(without);
  });

  it("changes the hash when the join link itself changes", () => {
    const moved: EventConference = {
      ...conference,
      entryPoints: [{ type: "video", uri: "https://meet.google.com/xyz-1234-abc" }],
    };

    expect(createSyncEventContentHash({ ...baseEvent, conference: moved }))
      .not.toBe(createSyncEventContentHash({ ...baseEvent, conference }));
  });

  it("re-ingests an event that only gained a meeting", () => {
    expect(identityKey({ conference })).not.toBe(identityKey());
  });

  it("leaves the ingest identity of a meeting-free event alone", () => {
    expect(identityKey({ conference: globalThis.undefined })).toBe(identityKey());
  });
});

describe("handing a conference to a destination", () => {
  it("passes the meeting on when the source's description is mirrored", () => {
    expect(resolveConference(false, serializeEventConference(conference)))
      .toEqual(conference);
  });

  it("withholds the meeting from a calendar mirrored as an opaque busy block", () => {
    /*
     * A join link is a way into the meeting, so it travels under the same consent
     * as the description it would otherwise have been written beside.
     */
    expect(resolveConference(true, serializeEventConference(conference))).toBeUndefined();
  });

  it("passes nothing on for a stored row that has no meeting", () => {
    expect(resolveConference(false, null)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { eventToICalString } from "../../src/providers/caldav/shared/ics";
import { normalizeCalDAVEvent } from "../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../src/providers/outlook/destination/normalize-event";
import { serializeGoogleEvent } from "../../src/providers/google/destination/serialize-event";
import { createEditableEventContentHash } from "../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../src/core/types";

const CONFERENCE_DELIMITER =
  "-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-";

const MEET_DETAILS = [
  "Join with Google Meet: https://meet.google.com/abc-defg-hij",
  "Or dial: (US) +1 555-555-5555 PIN: 123456789#",
  "More phone numbers: https://tel.meet/abc-defg-hij?pin=1234567890123",
  "",
  "Please do not edit this section.",
].join("\n");

const MEET_BLOCK = [
  CONFERENCE_DELIMITER,
  MEET_DETAILS,
  CONFERENCE_DELIMITER,
].join("\n");

/*
 * The shape Google guts on write: it keeps the span and discards everything
 * inside it, leaving a mirror with no link, no dial-in and no PIN.
 */
const SPAN_WRAPPED_MEET_BLOCK = `<span style="white-space:pre">${MEET_BLOCK}</span>`;

const createEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  description: SPAN_WRAPPED_MEET_BLOCK,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Standup",
  ...overrides,
});

const unfold = (ics: string): string => ics.replaceAll("\r\n ", "");

const getPropertyValue = (ics: string, name: string): string | undefined =>
  unfold(ics).split("\r\n").find((line) => line.startsWith(name))?.slice(name.length);

describe("the Google destination write boundary", () => {
  it("keeps the meeting details Google would delete along with its own delimiters", () => {
    expect(serializeGoogleEvent(createEvent(), "uid-1")?.description).toBe(MEET_DETAILS);
  });

  it("leaves punctuation that is not Google's conference delimiter alone", () => {
    const value = "Agenda\n----------\n:~: notes :~:\n-::~:~:: not the marker"
      + "\n-::~:~::~:~::~:~::-\nBudget";

    expect(serializeGoogleEvent(createEvent({ description: value }), "uid-1")?.description)
      .toBe(value);
  });

  it("expects back what it sent, so the mirror is compared against the text", () => {
    expect(createEditableEventContentHash(normalizeGoogleEvent(createEvent())))
      .toBe(createEditableEventContentHash(createEvent({ description: MEET_DETAILS })));
  });

  it("leaves a description that carries no markup and no delimiter alone", () => {
    expect(normalizeGoogleEvent(createEvent({ description: MEET_DETAILS })).description)
      .toBe(MEET_DETAILS);
  });
});

describe("the CalDAV destination write boundary", () => {
  it("writes DESCRIPTION as the iCalendar TEXT that RFC 5545 3.8.1.5 defines", () => {
    const ics = eventToICalString(createEvent(), "uid-1@keeper.sh");

    expect(getPropertyValue(ics, "DESCRIPTION:")).toBe(MEET_BLOCK.replaceAll("\n", String.raw`\n`));
    expect(ics).not.toContain("white-space:pre");
  });

  it("expects back what it wrote, so the mirror is compared against the text", () => {
    expect(createEditableEventContentHash(normalizeCalDAVEvent(createEvent())))
      .toBe(createEditableEventContentHash(createEvent({ description: MEET_BLOCK })));
  });

  it("does not render an Outlook body's markup as literal text to the reader", () => {
    const body = "<html><head><style>p.MsoNormal {margin:0in}</style></head>"
      + "<body><p class=\"MsoNormal\">Quarterly planning</p></body></html>";
    const ics = eventToICalString(createEvent({ description: body }), "uid-1@keeper.sh");

    expect(getPropertyValue(ics, "DESCRIPTION:")).toBe("Quarterly planning");
  });
});

describe("the CalDAV and Outlook destinations, which keep Google's delimiters", () => {
  it("keeps the delimited block a CalDAV client renders as the author saw it", () => {
    expect(normalizeCalDAVEvent(createEvent()).description).toBe(MEET_BLOCK);
  });
});

describe("the Outlook destination write boundary", () => {
  it("keeps the HTML body Microsoft Graph accepts", () => {
    expect(normalizeOutlookEvent(createEvent()).description).toBe(SPAN_WRAPPED_MEET_BLOCK);
  });
});

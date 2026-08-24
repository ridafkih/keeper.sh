import { describe, expect, it } from "vitest";
import { eventToICalString, parseICalToRemoteEvent } from "../../../src/providers/caldav/shared/ics";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../src/providers/outlook/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

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
 * The shape Google guts on write: it recognises the delimited region as its own
 * and discards everything the region holds, leaving a mirror with no link, no
 * dial-in and no PIN.
 */
const SPAN_WRAPPED_MEET_BLOCK = `<span style="white-space:pre">${MEET_BLOCK}</span>`;

const OUTLOOK_BODY = "<html><head><style>p.MsoNormal {margin:0in}</style></head>"
  + "<body><p class=\"MsoNormal\">Quarterly planning</p></body></html>";

const DESCRIPTIONS = [
  SPAN_WRAPPED_MEET_BLOCK,
  MEET_BLOCK,
  MEET_DETAILS,
  OUTLOOK_BODY,
  "<p>a &lt;br&gt; b</p>",
  "<ul><li>one</li><li>two</li></ul>",
  "Notes <b>bold</b> here",
  "A &amp; B, budget <= 5",
];

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
    expect(serializeGoogleEvent(createEvent(), "uid-1")?.description)
      .toBe(`<span style="white-space:pre">${MEET_DETAILS}</span>`);
    expect(serializeGoogleEvent(createEvent({ description: MEET_BLOCK }), "uid-1")?.description)
      .toBe(MEET_DETAILS);
  });

  it("keeps the markup Google accepts and stores back verbatim", () => {
    const values = [
      "Notes <b>bold</b> here",
      "<ul><li>one</li><li>two</li></ul>",
      "<a href=\"https://x.test/agenda\">Agenda</a>",
      OUTLOOK_BODY,
    ];

    for (const value of values) {
      expect(serializeGoogleEvent(createEvent({ description: value }), "uid-1")?.description)
        .toBe(value);
    }
  });

  it("sends back exactly what the comparison holds, for every description shape", () => {
    for (const description of DESCRIPTIONS) {
      const normalized = normalizeGoogleEvent(createEvent({ description }));

      expect(serializeGoogleEvent(normalized, "uid-1")?.description).toBe(normalized.description);
    }
  });

  it("closes the line its own delimiter sat on, without joining the prose around it", () => {
    const value = `Agenda\n${CONFERENCE_DELIMITER}\nBudget`;

    expect(serializeGoogleEvent(createEvent({ description: value }), "uid-1")?.description)
      .toBe("Agenda\nBudget");
  });

  it("leaves punctuation that is not Google's conference delimiter alone", () => {
    const value = "Agenda\n----------\n:~: notes :~:\n-::~:~:: not the marker"
      + "\n-::~:~::~:~::~:~::-\nBudget";

    expect(serializeGoogleEvent(createEvent({ description: value }), "uid-1")?.description)
      .toBe(value);
  });

  it("expects back what it sent, so the mirror is compared against the undelimited text", () => {
    const sent = `<span style="white-space:pre">${MEET_DETAILS}</span>`;

    expect(createEditableEventContentHash(normalizeGoogleEvent(createEvent())))
      .toBe(createEditableEventContentHash(createEvent({ description: sent })));
  });

  it("leaves a description that carries no markup and no delimiter alone", () => {
    expect(normalizeGoogleEvent(createEvent({ description: MEET_DETAILS })).description)
      .toBe(MEET_DETAILS);
  });
});

describe("the CalDAV destination write boundary", () => {
  it("writes DESCRIPTION as the iCalendar TEXT that RFC 5545 3.8.1.5 defines", () => {
    const ics = eventToICalString(normalizeCalDAVEvent(createEvent()), "uid-1@keeper.sh");

    expect(getPropertyValue(ics, "DESCRIPTION:")).toBe(MEET_BLOCK.replaceAll("\n", String.raw`\n`));
    expect(ics).not.toContain("white-space:pre");
  });

  it("expects back what it wrote, so the mirror is compared against the text", () => {
    expect(createEditableEventContentHash(normalizeCalDAVEvent(createEvent())))
      .toBe(createEditableEventContentHash(createEvent({ description: MEET_BLOCK })));
  });

  it("does not render an Outlook body's markup as literal text to the reader", () => {
    const ics = eventToICalString(
      normalizeCalDAVEvent(createEvent({ description: OUTLOOK_BODY })),
      "uid-1@keeper.sh",
    );

    expect(getPropertyValue(ics, "DESCRIPTION:")).toBe("Quarterly planning");
  });

  /*
   * The projection is a render, so applying it to its own output can peel a
   * layer the author escaped. The comparison and the write must therefore share
   * one application: a second one at the serializer would store text the
   * comparison never holds and replace the mirror on every run.
   */
  it("reads back exactly what the comparison holds, for every description shape", () => {
    for (const description of DESCRIPTIONS) {
      const normalized = normalizeCalDAVEvent(createEvent({ description }));
      const parsed = parseICalToRemoteEvent(eventToICalString(normalized, "uid-1@keeper.sh"));

      expect(parsed?.description).toBe(normalized.description);
    }
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

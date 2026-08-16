import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalDAVSourceWriter } from "../../../src/providers/caldav/source/mutations";
import { createGoogleSourceWriter } from "../../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../../src/providers/outlook/source/mutations";
import type { CalendarSourceWriter } from "../../../src/core/source/writer";

const ACCESS_TOKEN = "access-token";
const ACCOUNT_EMAIL = "me@example.com";
const SOURCE_EVENT_ID = "provider-event-id";
const SOURCE_EVENT_UID = "source-event-uid-1";
const CALENDAR_URL = "https://caldav.example.com/calendars/team";
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;
const OK_STATUS = 200;
const NO_CONTENT_STATUS = 204;
const NO_WRITES = 0;
const ONE_WRITE = 1;
const REFERENCE = { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID };
const UPDATES = { summary: "Renamed on the destination" } as const;

interface Harness {
  writer: CalendarSourceWriter;
  writes: () => number;
}

const stubProviderFetch = (event: Record<string, unknown>): (() => number) => {
  let writes = NO_WRITES;
  globalThis.fetch = vi.fn((_input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve(Response.json(event, { status: OK_STATUS }));
    }
    writes += ONE_WRITE;
    return Promise.resolve(new Response("{}", { status: OK_STATUS }));
  }) as unknown as typeof fetch;
  return () => writes;
};

const createCalDAVHarness = (data: string): Harness => {
  let writes = NO_WRITES;
  const client = {
    deleteCalendarObject: () => {
      writes += ONE_WRITE;
      return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
    },
    fetchCalendarObjects: () => Promise.resolve([{ data, url: OBJECT_URL }]),
    updateCalendarObject: () => {
      writes += ONE_WRITE;
      return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
    },
  };

  return {
    writer: createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(client),
    }),
    writes: () => writes,
  };
};

const createGoogleHarness = (event: Record<string, unknown>): Harness => ({
  writer: createGoogleSourceWriter({
    accessToken: () => Promise.resolve(ACCESS_TOKEN),
    externalCalendarId: null,
  }),
  writes: stubProviderFetch(event),
});

const createOutlookHarness = (event: Record<string, unknown>): Harness => ({
  writer: createOutlookSourceWriter({ accessToken: () => Promise.resolve(ACCESS_TOKEN) }),
  writes: stubProviderFetch(event),
});

const buildIcs = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Studio booked",
  ...lines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const LONE_SELF_ATTENDEE_ICS = buildIcs([
  `ORGANIZER;CN=Me:mailto:${ACCOUNT_EMAIL}`,
  `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;CN=Me:mailto:${ACCOUNT_EMAIL}`,
]);

/*
 * The shape Apple, Outlook and Nextcloud write for anything that was ever a meeting, and
 * what is left of one once the invitees are removed. Deleting it notifies nobody, so a
 * refusal there is a two-way connection shut down over an event nobody else is on — the
 * silent shutdown the rewrite was for, reached from the other side. Google already read it
 * this way; the other two counted the account's own entry as somebody else.
 */
const LONE_SELF_ATTENDEE_PROVIDERS = [
  {
    createHarness: () => createCalDAVHarness(LONE_SELF_ATTENDEE_ICS),
    name: "CalDAV",
  },
  {
    createHarness: () =>
      createGoogleHarness({
        attendees: [{ email: ACCOUNT_EMAIL, responseStatus: "accepted", self: true }],
        id: SOURCE_EVENT_ID,
        organizer: { email: ACCOUNT_EMAIL, self: true },
        summary: "Studio booked",
      }),
    name: "Google",
  },
  {
    createHarness: () =>
      createOutlookHarness({
        attendees: [{ emailAddress: { address: ACCOUNT_EMAIL }, type: "required" }],
        id: SOURCE_EVENT_ID,
        isOrganizer: true,
        organizer: { emailAddress: { address: ACCOUNT_EMAIL } },
        subject: "Studio booked",
      }),
    name: "Outlook",
  },
];

describe("an event whose only guest is the organizer", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const provider of LONE_SELF_ATTENDEE_PROVIDERS) {
    it(`${provider.name} writes the edit through`, async () => {
      const harness = provider.createHarness();

      const result = await harness.writer.updateEvent(REFERENCE, UPDATES);

      expect(result.refused).toBeUndefined();
      expect(harness.writes()).toBe(ONE_WRITE);
    });

    it(`${provider.name} deletes it`, async () => {
      const harness = provider.createHarness();

      const result = await harness.writer.deleteEvent(REFERENCE);

      expect(result.refused).toBeUndefined();
      expect(harness.writes()).toBe(ONE_WRITE);
    });
  }
});

const ATTENDEE_REFUSAL = "event_has_attendees";
const GUEST_EMAIL = "guest@another-company.com";

/*
 * A guest list the writer could not read is not an empty one. An ICS whose sub-component
 * never closes leaves every property after the BEGIN unwalked — the event's own ATTENDEE
 * lines among them — and Google says outright with attendeesOmitted that the list in the
 * representation is not the whole one. Answering either with "nobody is invited" destroys
 * a real meeting and mails a cancellation to everyone on it.
 */
const UNREADABLE_PROVIDERS = [
  {
    createHarness: () =>
      createCalDAVHarness(buildIcs([
        `ORGANIZER;CN=Me:mailto:${ACCOUNT_EMAIL}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT15M",
        `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${GUEST_EMAIL}`,
        "ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:second-guest@another-company.com",
      ])),
    name: "CalDAV, on an object whose sub-component never closes",
  },
  {
    createHarness: () =>
      createGoogleHarness({
        attendeesOmitted: true,
        id: SOURCE_EVENT_ID,
        organizer: { email: ACCOUNT_EMAIL, self: true },
        summary: "Studio booked",
      }),
    name: "Google, on a representation it marks as partial",
  },
];

describe("a guest list the writer could not read", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const provider of UNREADABLE_PROVIDERS) {
    it(`${provider.name} refuses the delete`, async () => {
      const harness = provider.createHarness();

      const result = await harness.writer.deleteEvent(REFERENCE);

      expect(result.refused).toBe(ATTENDEE_REFUSAL);
      expect(harness.writes()).toBe(NO_WRITES);
    });

    it(`${provider.name} refuses the edit`, async () => {
      const harness = provider.createHarness();

      const result = await harness.writer.updateEvent(REFERENCE, UPDATES);

      expect(result.refused).toBe(ATTENDEE_REFUSAL);
      expect(harness.writes()).toBe(NO_WRITES);
    });
  }
});

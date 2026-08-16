import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalDAVSourceWriter } from "../../../src/providers/caldav/source/mutations";
import { createGoogleSourceWriter } from "../../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../../src/providers/outlook/source/mutations";
import type { CalendarSourceWriter } from "../../../src/core/source/writer";

const ACCESS_TOKEN = "access-token";
const ACCOUNT_EMAIL = "me@example.com";
const OTHER_EMAIL = "colleague@example.com";
const THIRD_PARTY_EMAIL = "someone@another-company.com";
const SOURCE_EVENT_ID = "provider-event-id";
const SOURCE_EVENT_UID = "source-event-uid-1";
const SHARED_CALENDAR_ID = "team-calendar@group.calendar.google.com";
const CALENDAR_URL = "https://caldav.example.com/calendars/team";
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;
const OK_STATUS = 200;
const NO_CONTENT_STATUS = 204;
const NO_WRITES = 0;
const ONE_WRITE = 1;
const REFERENCE = { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID };
const UPDATES = { summary: "Renamed on the destination" } as const;
const ATTENDEE_REFUSAL = "event_has_attendees";

/*
 * The three writers held three separate authorship predicates and drifted apart under
 * them: Google excluded the account's own attendee entry, Outlook did not, and CalDAV
 * could not tell either way. One policy, stated once, is what stops that happening again,
 * so every provider is driven through the same table and must answer identically.
 *
 * The cases deliberately use a genuine third-party attendee rather than the account's own
 * entry. Which entries count as "other" is read from what each provider actually reports
 * and is not part of the shared rule.
 */
interface Situation {
  hasOtherAttendees: boolean;
  identityKnown: boolean;
  organizedByAccount: boolean;
}

const SITUATIONS: { name: string; refusal?: string; situation: Situation }[] = [
  {
    name: "the account's own event with nobody invited",
    situation: { hasOtherAttendees: false, identityKnown: true, organizedByAccount: true },
  },
  {
    name: "the account's own event with other people invited",
    refusal: ATTENDEE_REFUSAL,
    situation: { hasOtherAttendees: true, identityKnown: true, organizedByAccount: true },
  },
  {
    name: "somebody else's event with nobody invited",
    situation: { hasOtherAttendees: false, identityKnown: true, organizedByAccount: false },
  },
  {
    name: "somebody else's event with other people invited",
    refusal: ATTENDEE_REFUSAL,
    situation: { hasOtherAttendees: true, identityKnown: true, organizedByAccount: false },
  },
  {
    name: "an event nobody can be placed against, with nobody invited",
    situation: { hasOtherAttendees: false, identityKnown: false, organizedByAccount: false },
  },
  {
    name: "an event nobody can be placed against, with other people invited",
    refusal: ATTENDEE_REFUSAL,
    situation: { hasOtherAttendees: true, identityKnown: false, organizedByAccount: false },
  },
];

const expectedWrites = (refusal: string | undefined): number => {
  if (refusal) {
    return NO_WRITES;
  }
  return ONE_WRITE;
};

const resolveOrganizerEmail = (situation: Situation): string => {
  if (situation.organizedByAccount) {
    return ACCOUNT_EMAIL;
  }
  return OTHER_EMAIL;
};

const buildAttendeeLines = (situation: Situation): string[] => {
  if (situation.hasOtherAttendees) {
    return [`ATTENDEE:mailto:${THIRD_PARTY_EMAIL}`];
  }
  return [];
};

interface Harness {
  writer: CalendarSourceWriter;
  writes: () => number;
}

const buildIcs = (situation: Situation): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Studio booked",
  `ORGANIZER:mailto:${resolveOrganizerEmail(situation)}`,
  ...buildAttendeeLines(situation),
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const createCalDAVHarness = (situation: Situation): Harness => {
  let writes = NO_WRITES;
  const data = buildIcs(situation);
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

const buildGoogleEvent = (situation: Situation): Record<string, unknown> => ({
  ...(situation.identityKnown && {
    creator: { email: resolveOrganizerEmail(situation), self: situation.organizedByAccount },
    organizer: { email: resolveOrganizerEmail(situation), self: situation.organizedByAccount },
  }),
  ...(situation.hasOtherAttendees && {
    attendees: [{ email: ACCOUNT_EMAIL, self: true }, { email: THIRD_PARTY_EMAIL }],
  }),
  id: SOURCE_EVENT_ID,
  summary: "Studio booked",
});

const buildOutlookEvent = (situation: Situation): Record<string, unknown> => ({
  ...(situation.identityKnown && {
    isOrganizer: situation.organizedByAccount,
    organizer: { emailAddress: { address: resolveOrganizerEmail(situation) } },
  }),
  ...(situation.hasOtherAttendees && {
    attendees: [{ emailAddress: { address: THIRD_PARTY_EMAIL } }],
  }),
  id: SOURCE_EVENT_ID,
  subject: "Studio booked",
});

const createGoogleHarness = (situation: Situation): Harness => {
  const providerWrites = stubProviderFetch(buildGoogleEvent(situation));
  return {
    writer: createGoogleSourceWriter({
      accessToken: () => Promise.resolve(ACCESS_TOKEN),
      externalCalendarId: SHARED_CALENDAR_ID,
    }),
    writes: providerWrites,
  };
};

const createOutlookHarness = (situation: Situation): Harness => {
  const providerWrites = stubProviderFetch(buildOutlookEvent(situation));
  return {
    writer: createOutlookSourceWriter({
      accessToken: () => Promise.resolve(ACCESS_TOKEN),
    }),
    writes: providerWrites,
  };
};

const PROVIDERS = [
  { createHarness: createCalDAVHarness, name: "CalDAV" },
  { createHarness: createGoogleHarness, name: "Google" },
  { createHarness: createOutlookHarness, name: "Outlook" },
];

describe("every source writer answers one refusal rule the same way", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const provider of PROVIDERS) {
    for (const { name, refusal, situation } of SITUATIONS) {
      it(`${provider.name} answers ${name} on an edit`, async () => {
        const harness = provider.createHarness(situation);

        const result = await harness.writer.updateEvent(REFERENCE, UPDATES);

        expect(result.refused).toBe(refusal);
        expect(harness.writes()).toBe(expectedWrites(refusal));
      });

      it(`${provider.name} answers ${name} on a delete`, async () => {
        const harness = provider.createHarness(situation);

        const result = await harness.writer.deleteEvent(REFERENCE);

        expect(result.refused).toBe(refusal);
        expect(harness.writes()).toBe(expectedWrites(refusal));
      });
    }
  }
});

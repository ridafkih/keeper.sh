import { convertIcsCalendar, generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { decryptPassword } from "@keeper.sh/encryption";
import { createDAVClient } from "tsdav";
import type { EventInput, EventUpdateInput, EventActionResult, RsvpStatus } from "../../mutation-types";

interface CalDAVCredentials {
  serverUrl: string;
  calendarUrl: string;
  username: string;
  encryptedPassword: string;
  encryptionKey: string;
}

const getClient = async (credentials: CalDAVCredentials) => {
  const password = decryptPassword(credentials.encryptedPassword, credentials.encryptionKey);
  return createDAVClient({
    authMethod: "Basic",
    credentials: { username: credentials.username, password },
    defaultAccountType: "caldav",
    serverUrl: credentials.serverUrl,
  });
};

const generateUid = (): string => `${crypto.randomUUID()}@keeper.sh`;

const ensureTrailingSlash = (url: string): string => {
  if (url.endsWith("/")) {
    return url;
  }
  return `${url}/`;
};

const buildIcsEvent = (uid: string, input: EventInput): IcsEvent => {
  const isAllDay = input.isAllDay ?? false;

  return {
    uid,
    summary: input.title,
    description: input.description,
    location: input.location,
    start: {
      date: new Date(input.startTime),
      ...(isAllDay && { type: "DATE" as const }),
    },
    end: {
      date: new Date(input.endTime),
      ...(isAllDay && { type: "DATE" as const }),
    },
    stamp: { date: new Date() },
    ...(input.availability === "free" && { timeTransparent: "TRANSPARENT" as const }),
  };
};

const buildIcsCalendar = (events: IcsEvent[]): IcsCalendar => ({
  events,
  prodId: "-//Keeper//Keeper Calendar//EN",
  version: "2.0",
});

interface CalDAVEventResult {
  sourceEventUid: string;
}

const createCalDAVEvent = async (
  credentials: CalDAVCredentials,
  input: EventInput,
): Promise<EventActionResult & Partial<CalDAVEventResult>> => {
  try {
    const client = await getClient(credentials);
    const uid = generateUid();
    const event = buildIcsEvent(uid, input);
    const icsString = generateIcsCalendar(buildIcsCalendar([event]));

    await client.createCalendarObject({
      calendar: { url: credentials.calendarUrl },
      filename: `${uid}.ics`,
      iCalString: icsString,
    });

    return { success: true, sourceEventUid: uid };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CalDAV create failed.";
    return { success: false, error: message };
  }
};

const fetchCalendarObject = async (
  client: Awaited<ReturnType<typeof createDAVClient>>,
  calendarUrl: string,
  sourceEventUid: string,
): Promise<{ url: string; data: string } | null> => {
  const objectUrl = `${ensureTrailingSlash(calendarUrl)}${sourceEventUid}.ics`;

  try {
    const objects = await client.fetchCalendarObjects({
      calendar: { url: calendarUrl },
      objectUrls: [objectUrl],
    });

    const [object] = objects;
    if (object?.data) {
      return { url: object.url, data: object.data };
    }
  } catch {
    // Object may not exist at that URL
  }

  return null;
};

const parseIcsString = (icsString: string): IcsCalendar => {
  return convertIcsCalendar(undefined, icsString);
};

const applyUpdatesToEvent = (event: IcsEvent, updates: EventUpdateInput): IcsEvent => {
  const updated = { ...event };

  if (updates.title !== undefined) {
    updated.summary = updates.title;
  }
  if (updates.description !== undefined) {
    updated.description = updates.description;
  }
  if (updates.location !== undefined) {
    updated.location = updates.location;
  }
  if (updates.startTime !== undefined) {
    const isAllDay = updates.isAllDay ?? event.start?.type === "DATE";
    updated.start = {
      date: new Date(updates.startTime),
      ...(isAllDay && { type: "DATE" as const }),
    };
  }
  if (updates.endTime !== undefined) {
    const isAllDay = updates.isAllDay ?? event.start?.type === "DATE";
    updated.end = {
      date: new Date(updates.endTime),
      ...(isAllDay && { type: "DATE" as const }),
    };
  }
  if (updates.availability !== undefined) {
    if (updates.availability === "free") {
      updated.timeTransparent = "TRANSPARENT";
    } else {
      updated.timeTransparent = "OPAQUE";
    }
  }

  updated.stamp = { date: new Date() };

  return updated;
};

const updateCalDAVEvent = async (
  credentials: CalDAVCredentials,
  sourceEventUid: string,
  updates: EventUpdateInput,
): Promise<EventActionResult> => {
  try {
    const client = await getClient(credentials);
    const existing = await fetchCalendarObject(client, credentials.calendarUrl, sourceEventUid);

    if (!existing) {
      return { success: false, error: "Event not found on CalDAV server." };
    }

    const calendar = parseIcsString(existing.data);
    const [event] = calendar.events ?? [];

    if (!event) {
      return { success: false, error: "Could not parse event from CalDAV server." };
    }

    const updatedEvent = applyUpdatesToEvent(event, updates);
    const updatedCalendar = buildIcsCalendar([updatedEvent]);
    const icsString = generateIcsCalendar(updatedCalendar);

    await client.updateCalendarObject({
      calendarObject: {
        url: existing.url,
        data: icsString,
      },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CalDAV update failed.";
    return { success: false, error: message };
  }
};

const deleteCalDAVEvent = async (
  credentials: CalDAVCredentials,
  sourceEventUid: string,
): Promise<EventActionResult> => {
  try {
    const client = await getClient(credentials);
    const objectUrl = `${ensureTrailingSlash(credentials.calendarUrl)}${sourceEventUid}.ics`;

    try {
      await client.deleteCalendarObject({
        calendarObject: { url: objectUrl },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== HTTP_STATUS.NOT_FOUND) {
        throw error;
      }
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CalDAV delete failed.";
    return { success: false, error: message };
  }
};

const PARTSTAT_MAP: Record<RsvpStatus, "ACCEPTED" | "DECLINED" | "TENTATIVE"> = {
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
};

const rsvpCalDAVEvent = async (
  credentials: CalDAVCredentials,
  sourceEventUid: string,
  status: RsvpStatus,
  userEmail: string,
): Promise<EventActionResult> => {
  try {
    const client = await getClient(credentials);
    const existing = await fetchCalendarObject(client, credentials.calendarUrl, sourceEventUid);

    if (!existing) {
      return { success: false, error: "Event not found on CalDAV server." };
    }

    const calendar = parseIcsString(existing.data);
    const [event] = calendar.events ?? [];

    if (!event) {
      return { success: false, error: "Could not parse event from CalDAV server." };
    }

    const partstat = PARTSTAT_MAP[status];
    const normalizedEmail = userEmail.toLowerCase();
    const attendees = event.attendees ?? [];
    let foundAttendee = false;

    const updatedAttendees = attendees.map((attendee) => {
      if (attendee.email.toLowerCase() === normalizedEmail) {
        foundAttendee = true;
        return { ...attendee, partstat };
      }
      return attendee;
    });

    if (!foundAttendee) {
      updatedAttendees.push({
        email: userEmail,
        partstat,
      });
    }

    const updatedEvent: IcsEvent = {
      ...event,
      attendees: updatedAttendees,
      stamp: { date: new Date() },
    };

    const updatedCalendar = buildIcsCalendar([updatedEvent]);
    const icsString = generateIcsCalendar(updatedCalendar);

    await client.updateCalendarObject({
      calendarObject: {
        url: existing.url,
        data: icsString,
      },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CalDAV RSVP failed.";
    return { success: false, error: message };
  }
};

export { createCalDAVEvent, updateCalDAVEvent, deleteCalDAVEvent, rsvpCalDAVEvent };

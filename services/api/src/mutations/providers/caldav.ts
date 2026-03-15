import { convertIcsCalendar, generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import { HTTP_STATUS, KEEPER_USER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { decryptPassword } from "@keeper.sh/database";
import { createDAVClient } from "tsdav";
import type { EventInput, EventUpdateInput, EventActionResult, RsvpStatus } from "@/types";

interface CalDAVCredentials {
  serverUrl: string;
  calendarUrl: string;
  username: string;
  encryptedPassword: string;
  encryptionKey: string;
}

const getClient = (credentials: CalDAVCredentials) => {
  const password = decryptPassword(credentials.encryptedPassword, credentials.encryptionKey);
  return createDAVClient({
    authMethod: "Basic",
    credentials: { username: credentials.username, password },
    defaultAccountType: "caldav",
    serverUrl: credentials.serverUrl,
  });
};

const generateUid = (): string => `${crypto.randomUUID()}${KEEPER_USER_EVENT_SUFFIX}`;

const ensureTrailingSlash = (url: string): string => {
  if (url.endsWith("/")) {
    return url;
  }
  return `${url}/`;
};

const resolveIsAllDay = (input: { isAllDay?: boolean }): boolean => {
  if (input.isAllDay === true) {
    return true;
  }
  return false;
};

const buildIcsEvent = (uid: string, input: EventInput): IcsEvent => {
  const isAllDay = resolveIsAllDay(input);

  const event: IcsEvent = {
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
  };

  if (input.availability === "free") {
    event.timeTransparent = "TRANSPARENT";
  }

  return event;
};

const buildIcsCalendar = (events: IcsEvent[]): IcsCalendar => ({
  events,
  prodId: "-//Keeper//Keeper Calendar//EN",
  version: "2.0",
});

interface CalDAVEventResult {
  sourceEventUid: string;
}

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

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
    return { success: false, error: extractErrorMessage(error, "CalDAV create failed.") };
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

// eslint-disable-next-line no-undefined -- convertIcsCalendar requires undefined as first arg for no schema
const parseIcsString = (icsString: string): IcsCalendar => convertIcsCalendar(undefined, icsString);

const resolveEventIsAllDay = (updates: EventUpdateInput, event: IcsEvent): boolean => {
  if (updates.isAllDay === true || updates.isAllDay === false) {
    return updates.isAllDay;
  }
  return event.start?.type === "DATE";
};

const resolveTransparency = (availability: string): "TRANSPARENT" | "OPAQUE" => {
  if (availability === "free") {
    return "TRANSPARENT";
  }
  return "OPAQUE";
};

const applyUpdatesToEvent = (event: IcsEvent, updates: EventUpdateInput): IcsEvent => {
  const updated = { ...event };

  if ("title" in updates && typeof updates.title === "string") {
    updated.summary = updates.title;
  }
  if ("description" in updates) {
    updated.description = updates.description;
  }
  if ("location" in updates) {
    updated.location = updates.location;
  }
  if ("startTime" in updates && typeof updates.startTime === "string") {
    const isAllDay = resolveEventIsAllDay(updates, event);
    updated.start = {
      date: new Date(updates.startTime),
      ...(isAllDay && { type: "DATE" as const }),
    };
  }
  if ("endTime" in updates && typeof updates.endTime === "string") {
    const isAllDay = resolveEventIsAllDay(updates, event);
    updated.end = {
      date: new Date(updates.endTime),
      ...(isAllDay && { type: "DATE" as const }),
    };
  }
  if ("availability" in updates && typeof updates.availability === "string") {
    updated.timeTransparent = resolveTransparency(updates.availability);
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
    return { success: false, error: extractErrorMessage(error, "CalDAV update failed.") };
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
      const { status } = error as { status?: number };
      if (status !== HTTP_STATUS.NOT_FOUND) {
        throw error;
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error, "CalDAV delete failed.") };
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
    return { success: false, error: extractErrorMessage(error, "CalDAV RSVP failed.") };
  }
};

const getPendingCalDAVInvites = async (
  credentials: CalDAVCredentials,
  from: string,
  to: string,
  userEmail: string,
): Promise<{
  sourceEventUid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  organizer: string | null;
}[]> => {
  try {
    const client = await getClient(credentials);
    const objects = await client.fetchCalendarObjects({
      calendar: { url: credentials.calendarUrl },
      timeRange: { start: from, end: to },
    });

    const pendingEvents: {
      sourceEventUid: string;
      title: string | null;
      description: string | null;
      location: string | null;
      startTime: string;
      endTime: string;
      isAllDay: boolean;
      organizer: string | null;
    }[] = [];

    const normalizedEmail = userEmail.toLowerCase();

    for (const object of objects) {
      if (!object.data) {
        continue;
      }

      const calendar = parseIcsString(object.data);
      const [event] = calendar.events ?? [];

      if (!event) {
        continue;
      }

      const attendees = event.attendees ?? [];
      const userAttendee = attendees.find(
        (attendee) => attendee.email.toLowerCase() === normalizedEmail,
      );

      if (!userAttendee) {
        continue;
      }

      if (userAttendee.partstat !== "NEEDS-ACTION") {
        continue;
      }

      const isAllDay = event.start?.type === "DATE";
      const organizerEmail = event.organizer?.email ?? null;
      const endTime = event.end?.date?.toISOString() ?? event.start.date.toISOString();

      pendingEvents.push({
        sourceEventUid: event.uid,
        title: event.summary ?? null,
        description: event.description ?? null,
        location: event.location ?? null,
        startTime: event.start.date.toISOString(),
        endTime,
        isAllDay,
        organizer: organizerEmail,
      });
    }

    return pendingEvents;
  } catch {
    return [];
  }
};

export { createCalDAVEvent, updateCalDAVEvent, deleteCalDAVEvent, rsvpCalDAVEvent, getPendingCalDAVInvites };

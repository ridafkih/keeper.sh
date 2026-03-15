import { HTTP_STATUS } from "@keeper.sh/constants";
import { googleApiErrorSchema } from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { EventInput, EventUpdateInput, EventActionResult, RsvpStatus } from "../../mutation-types";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3/";

const buildHeaders = (accessToken: string): Record<string, string> => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const getCalendarId = (externalCalendarId: string | null): string =>
  externalCalendarId ?? "primary";

const handleErrorResponse = async (response: Response): Promise<string> => {
  const body = await response.json();
  const { error } = googleApiErrorSchema.assert(body);
  return error?.message ?? response.statusText;
};

interface GoogleEventResult {
  sourceEventUid: string;
}

const createGoogleEvent = async (
  accessToken: string,
  externalCalendarId: string | null,
  input: EventInput,
): Promise<EventActionResult & Partial<GoogleEventResult>> => {
  const calendarId = getCalendarId(externalCalendarId);
  const url = new URL(`calendars/${encodeURIComponent(calendarId)}/events`, GOOGLE_CALENDAR_API);

  const isAllDay = input.isAllDay ?? false;
  const resource: GoogleEvent = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };

  if (isAllDay) {
    resource.start = { date: input.startTime.slice(0, 10) };
    resource.end = { date: input.endTime.slice(0, 10) };
  } else {
    resource.start = { dateTime: input.startTime };
    resource.end = { dateTime: input.endTime };
  }

  if (input.availability === "free") {
    resource.transparency = "transparent";
  }

  const response = await fetch(url, {
    body: JSON.stringify(resource),
    headers: buildHeaders(accessToken),
    method: "POST",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  const created = await response.json() as GoogleEvent;
  return { success: true, sourceEventUid: created.iCalUID };
};

const findGoogleEventByUid = async (
  accessToken: string,
  externalCalendarId: string | null,
  sourceEventUid: string,
): Promise<GoogleEvent | null> => {
  const calendarId = getCalendarId(externalCalendarId);
  const url = new URL(`calendars/${encodeURIComponent(calendarId)}/events`, GOOGLE_CALENDAR_API);
  url.searchParams.set("iCalUID", sourceEventUid);

  const response = await fetch(url, {
    headers: buildHeaders(accessToken),
    method: "GET",
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json() as { items?: GoogleEvent[] };
  const [item] = body.items ?? [];
  return item ?? null;
};

const buildGoogleDateField = (
  dateTime: string,
  isAllDay: boolean,
): { date: string } | { dateTime: string } => {
  if (isAllDay) {
    return { date: dateTime.slice(0, 10) };
  }

  return { dateTime };
};

const resolveGoogleTransparency = (availability: string): string => {
  if (availability === "free") {
    return "transparent";
  }

  return "opaque";
};

const updateGoogleEvent = async (
  accessToken: string,
  externalCalendarId: string | null,
  sourceEventUid: string,
  updates: EventUpdateInput,
): Promise<EventActionResult> => {
  const existing = await findGoogleEventByUid(accessToken, externalCalendarId, sourceEventUid);

  if (!existing?.id) {
    return { success: false, error: "Event not found on Google Calendar." };
  }

  const calendarId = getCalendarId(externalCalendarId);
  const url = new URL(
    `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`,
    GOOGLE_CALENDAR_API,
  );

  const patch: Record<string, unknown> = {};
  if ("title" in updates) {
    patch.summary = updates.title;
  }
  if ("description" in updates) {
    patch.description = updates.description;
  }
  if ("location" in updates) {
    patch.location = updates.location;
  }

  const hasExistingDateStart = existing.start && "date" in existing.start;
  const isAllDay = updates.isAllDay ?? (hasExistingDateStart === true);
  if ("startTime" in updates) {
    patch.start = buildGoogleDateField(updates.startTime as string, isAllDay);
  }
  if ("endTime" in updates) {
    patch.end = buildGoogleDateField(updates.endTime as string, isAllDay);
  }
  if ("availability" in updates) {
    patch.transparency = resolveGoogleTransparency(updates.availability as string);
  }

  const response = await fetch(url, {
    body: JSON.stringify(patch),
    headers: buildHeaders(accessToken),
    method: "PATCH",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.json();
  return { success: true };
};

const deleteGoogleEvent = async (
  accessToken: string,
  externalCalendarId: string | null,
  sourceEventUid: string,
): Promise<EventActionResult> => {
  const existing = await findGoogleEventByUid(accessToken, externalCalendarId, sourceEventUid);

  if (!existing?.id) {
    return { success: true };
  }

  const calendarId = getCalendarId(externalCalendarId);
  const url = new URL(
    `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`,
    GOOGLE_CALENDAR_API,
  );

  const response = await fetch(url, {
    headers: buildHeaders(accessToken),
    method: "DELETE",
  });

  if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.body?.cancel?.();
  return { success: true };
};

const rsvpGoogleEvent = async (
  accessToken: string,
  externalCalendarId: string | null,
  sourceEventUid: string,
  status: RsvpStatus,
  userEmail: string,
): Promise<EventActionResult> => {
  const existing = await findGoogleEventByUid(accessToken, externalCalendarId, sourceEventUid);

  if (!existing?.id) {
    return { success: false, error: "Event not found on Google Calendar." };
  }

  const calendarId = getCalendarId(externalCalendarId);
  const url = new URL(
    `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`,
    GOOGLE_CALENDAR_API,
  );

  const rawEvent = existing as Record<string, unknown>;
  let attendees: { email?: string; responseStatus?: string; self?: boolean }[] = [];
  if (Array.isArray(rawEvent.attendees)) {
    attendees = rawEvent.attendees as { email?: string; responseStatus?: string; self?: boolean }[];
  }
  const normalizedEmail = userEmail.toLowerCase();
  let found = false;

  const updatedAttendees = attendees.map((attendee) => {
    const attendeeEmail = (attendee.email ?? "").toLowerCase();
    if (attendeeEmail === normalizedEmail || attendee.self === true) {
      found = true;
      return { ...attendee, responseStatus: status };
    }
    return attendee;
  });

  if (!found) {
    updatedAttendees.push({
      email: userEmail,
      responseStatus: status,
      self: true,
    });
  }

  const response = await fetch(url, {
    body: JSON.stringify({ attendees: updatedAttendees }),
    headers: buildHeaders(accessToken),
    method: "PATCH",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.json();
  return { success: true };
};

interface GoogleAttendee {
  email?: string;
  responseStatus?: string;
  self?: boolean;
}

interface GoogleEventWithAttendees extends GoogleEvent {
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; displayName?: string };
}

interface PendingGoogleEvent {
  sourceEventUid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  organizer: string | null;
}

const parseGooglePendingEvent = (event: GoogleEventWithAttendees): PendingGoogleEvent | null => {
  const selfAttendee = (event.attendees ?? []).find(
    (attendee) => attendee.self === true,
  );

  if (!selfAttendee) {
    return null;
  }

  if (selfAttendee.responseStatus !== "needsAction") {
    return null;
  }

  if (!event.iCalUID) {
    return null;
  }

  const startTime = event.start?.dateTime ?? event.start?.date;
  const endTime = event.end?.dateTime ?? event.end?.date;

  if (!startTime || !endTime) {
    return null;
  }

  const isAllDay = Boolean(event.start && "date" in event.start);

  return {
    sourceEventUid: event.iCalUID,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    startTime,
    endTime,
    isAllDay,
    organizer: event.organizer?.email ?? null,
  };
};

const fetchGoogleEventsPage = async (
  accessToken: string,
  calendarId: string,
  from: string,
  to: string,
  pageToken: string | null,
): Promise<{ items: GoogleEventWithAttendees[]; nextPageToken: string | null }> => {
  const url = new URL(`calendars/${encodeURIComponent(calendarId)}/events`, GOOGLE_CALENDAR_API);
  url.searchParams.set("timeMin", from);
  url.searchParams.set("timeMax", to);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", "250");
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetch(url, {
    headers: buildHeaders(accessToken),
    method: "GET",
  });

  if (!response.ok) {
    return { items: [], nextPageToken: null };
  }

  const body = await response.json() as {
    items?: GoogleEventWithAttendees[];
    nextPageToken?: string;
  };

  return {
    items: body.items ?? [],
    nextPageToken: body.nextPageToken ?? null,
  };
};

const getPendingGoogleInvites = async (
  accessToken: string,
  externalCalendarId: string | null,
  from: string,
  to: string,
): Promise<PendingGoogleEvent[]> => {
  const calendarId = getCalendarId(externalCalendarId);
  const pendingEvents: PendingGoogleEvent[] = [];

  let pageToken: string | null = null;

  do {
    const page = await fetchGoogleEventsPage(accessToken, calendarId, from, to, pageToken);

    for (const event of page.items) {
      const parsed = parseGooglePendingEvent(event);
      if (parsed) {
        pendingEvents.push(parsed);
      }
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  return pendingEvents;
};

export { createGoogleEvent, updateGoogleEvent, deleteGoogleEvent, rsvpGoogleEvent, getPendingGoogleInvites };

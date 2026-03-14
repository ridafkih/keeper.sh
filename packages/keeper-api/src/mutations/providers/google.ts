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
  return { success: true, sourceEventUid: created.iCalUID ?? created.id ?? undefined };
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
  if (updates.title !== undefined) {
    patch.summary = updates.title;
  }
  if (updates.description !== undefined) {
    patch.description = updates.description;
  }
  if (updates.location !== undefined) {
    patch.location = updates.location;
  }

  const isAllDay = updates.isAllDay ?? existing.start?.date !== undefined;
  if (updates.startTime !== undefined) {
    if (isAllDay) {
      patch.start = { date: updates.startTime.slice(0, 10) };
    } else {
      patch.start = { dateTime: updates.startTime };
    }
  }
  if (updates.endTime !== undefined) {
    if (isAllDay) {
      patch.end = { date: updates.endTime.slice(0, 10) };
    } else {
      patch.end = { dateTime: updates.endTime };
    }
  }
  if (updates.availability !== undefined) {
    patch.transparency = updates.availability === "free" ? "transparent" : "opaque";
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
  const attendees = (Array.isArray(rawEvent.attendees) ? rawEvent.attendees : []) as Array<{ email?: string; responseStatus?: string; self?: boolean }>;
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

export { createGoogleEvent, updateGoogleEvent, deleteGoogleEvent, rsvpGoogleEvent };

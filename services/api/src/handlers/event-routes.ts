import { normalizeDateRange, parseDateRangeParams } from "@/utils/date-range";
import { withEventReadErrorHandling } from "@/utils/event-read-errors";
import { ErrorResponse } from "@/utils/responses";
import { parseViewerTimeZone } from "@/utils/viewer-time-zone";
import type { KeeperEvent, KeeperEventFilters, KeeperEventRangeInput } from "@/types";

interface EventsInRangeReader {
  getEventsInRange: (userId: string, range: KeeperEventRangeInput) => Promise<KeeperEvent[]>;
}

interface V1EventsReader {
  getEventCount: (userId: string, range: { from: Date; to: Date; timeZone?: string }) => Promise<number>;
  getEventsInRange: (
    userId: string,
    range: KeeperEventRangeInput,
    filters?: KeeperEventFilters,
  ) => Promise<KeeperEvent[]>;
}

interface EventReader {
  getEvent: (userId: string, eventId: string) => Promise<KeeperEvent | null>;
}

const handleGetEventsInRangeRoute = (
  request: Request,
  userId: string,
  reader: EventsInRangeReader,
): Promise<Response> => withEventReadErrorHandling(async () => {
  const url = new URL(request.url);
  const { from, to } = parseDateRangeParams(url);
  const { end, start } = normalizeDateRange(from, to);
  const timeZone = parseViewerTimeZone(url);
  const events = await reader.getEventsInRange(
    userId,
    { from: start, to: end, ...(timeZone && { timeZone }) },
  );
  return Response.json(events);
});

const parseEventFilters = (url: URL): KeeperEventFilters => {
  const filters: KeeperEventFilters = {};

  const calendarId = url.searchParams.get("calendarId");
  if (calendarId) {
    filters.calendarId = calendarId.split(",").filter(Boolean);
  }

  const availability = url.searchParams.get("availability");
  if (availability) {
    filters.availability = availability.split(",").filter(Boolean);
  }

  const isAllDay = url.searchParams.get("isAllDay");
  if (isAllDay === "true") {
    filters.isAllDay = true;
  } else if (isAllDay === "false") {
    filters.isAllDay = false;
  }

  return filters;
};

const handleGetV1EventsRoute = (
  request: Request,
  userId: string,
  reader: V1EventsReader,
): Promise<Response> => withEventReadErrorHandling(async () => {
  const url = new URL(request.url);
  const { from, to } = parseDateRangeParams(url);
  const { end, start } = normalizeDateRange(from, to);
  const timeZone = parseViewerTimeZone(url);
  const range = { from: start, to: end, ...(timeZone && { timeZone }) };

  if (url.searchParams.get("count") === "true") {
    const count = await reader.getEventCount(userId, range);
    return Response.json({ count });
  }

  const events = await reader.getEventsInRange(userId, range, parseEventFilters(url));
  return Response.json(events);
});

const handleGetEventRoute = (
  eventId: string | null,
  userId: string,
  reader: EventReader,
): Promise<Response> => withEventReadErrorHandling(async () => {
  if (!eventId) {
    return ErrorResponse.badRequest("Event ID is required.").toResponse();
  }

  const event = await reader.getEvent(userId, eventId);

  if (!event) {
    return ErrorResponse.notFound("Event not found.").toResponse();
  }

  return Response.json(event);
});

export { handleGetEventsInRangeRoute, handleGetEventRoute, handleGetV1EventsRoute };
export type { EventReader, EventsInRangeReader, V1EventsReader };

import { normalizeDateRange, parseDateRangeParams } from "@/utils/date-range";
import { withEventReadErrorHandling } from "@/utils/event-read-errors";
import { ErrorResponse } from "@/utils/responses";
import type { KeeperEvent, KeeperEventRangeInput } from "@/types";

interface EventsInRangeReader {
  getEventsInRange: (userId: string, range: KeeperEventRangeInput) => Promise<KeeperEvent[]>;
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
  const events = await reader.getEventsInRange(userId, { from: start, to: end });
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

export { handleGetEventsInRangeRoute, handleGetEventRoute };
export type { EventReader, EventsInRangeReader };

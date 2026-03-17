import { HTTP_STATUS } from "@keeper.sh/constants";
import { createKeeperApi } from "@/read-models";
import type { RsvpStatus } from "@/types";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { eventPatchBodySchema } from "@/utils/request-body";
import { database, oauthProviders, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  encryptionKey,
});

const GET = withWideEvent(
  withV1Auth(async ({ params, userId }) => {
    const eventId = params.id;
    if (!eventId) {
      return ErrorResponse.badRequest("Event ID is required.").toResponse();
    }
    const event = await keeperApi.getEvent(userId, eventId);

    if (!event) {
      return ErrorResponse.notFound("Event not found.").toResponse();
    }

    return Response.json(event);
  }),
);

const PATCH = withWideEvent(
  withV1Auth(async ({ request, params, userId }) => {
    const eventId = params.id;
    if (!eventId) {
      return ErrorResponse.badRequest("Event ID is required.").toResponse();
    }

    const body = await request.json();

    try {
      const validated = eventPatchBodySchema.assert(body);

      if (validated.rsvpStatus) {
        const result = await keeperApi.rsvpEvent(userId, eventId, validated.rsvpStatus as RsvpStatus);

        if (!result.success) {
          return ErrorResponse.badRequest(result.error ?? "Failed to update RSVP status.").toResponse();
        }

        return Response.json({ rsvpStatus: validated.rsvpStatus });
      }

      const result = await keeperApi.updateEvent(userId, eventId, {
        title: validated.title,
        description: validated.description,
        location: validated.location,
        startTime: validated.startTime,
        endTime: validated.endTime,
        isAllDay: validated.isAllDay,
        availability: validated.availability,
      });

      if (!result.success) {
        return ErrorResponse.badRequest(result.error ?? "Failed to update event.").toResponse();
      }

      const updated = await keeperApi.getEvent(userId, eventId);
      return Response.json(updated);
    } catch {
      return ErrorResponse.badRequest("Invalid update data.").toResponse();
    }
  }),
);

const DELETE = withWideEvent(
  withV1Auth(async ({ params, userId }) => {
    const eventId = params.id;
    if (!eventId) {
      return ErrorResponse.badRequest("Event ID is required.").toResponse();
    }
    const result = await keeperApi.deleteEvent(userId, eventId);

    if (!result.success) {
      return ErrorResponse.badRequest(result.error ?? "Failed to delete event.").toResponse();
    }

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  }),
);

export { GET, PATCH, DELETE };

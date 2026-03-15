import { HTTP_STATUS } from "@keeper.sh/constants";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import type { RsvpStatus } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { respondWithLoggedError } from "../../../../utils/logging";
import { eventPatchBodySchema } from "../../../../utils/request-body";
import { database, oauthProviders, encryptionKey } from "../../../../context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  encryptionKey,
});

export const GET = withWideEvent(
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

export const PATCH = withWideEvent(
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

      const { rsvpStatus: _, ...updates } = validated;
      const result = await keeperApi.updateEvent(userId, eventId, updates);

      if (!result.success) {
        return ErrorResponse.badRequest(result.error ?? "Failed to update event.").toResponse();
      }

      const updated = await keeperApi.getEvent(userId, eventId);
      return Response.json(updated);
    } catch (error) {
      return respondWithLoggedError(
        error,
        ErrorResponse.badRequest("Invalid update data.").toResponse(),
      );
    }
  }),
);

export const DELETE = withWideEvent(
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

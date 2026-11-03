import { HTTP_STATUS } from "@keeper.sh/constants";
import { handleGetV1EventsRoute } from "@/handlers/event-routes";
import { createKeeperApi } from "@/read-models";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { labelFailureResponse } from "@/utils/error-labelling";
import { eventCreateBodySchema } from "@/utils/request-body";
import { database, oauthProviders, refreshLockStore, encryptionKey, googleInteractiveRateLimiter } from "@/context";

const keeperApi = createKeeperApi(database, {
  googleRateLimiter: googleInteractiveRateLimiter,
  oauthTokenRefresher: oauthProviders,
  refreshLockStore,
  encryptionKey,
});

const GET = withWideEvent(
  withV1Auth(({ request, userId }) => handleGetV1EventsRoute(request, userId, keeperApi)),
);

const POST = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { timezone, ...input } = eventCreateBodySchema.assert(body);

      const result = await keeperApi.createEvent(userId, { ...input, startTimeZone: timezone });

      if (!result.success) {
        return ErrorResponse.badRequest(result.error ?? "Failed to create event.").toResponse();
      }

      return Response.json(result.event ?? { created: true }, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      const databaseResponse = labelFailureResponse(error, { slug: "invalid-request-body" });
      if (databaseResponse) {
        return databaseResponse;
      }

      return ErrorResponse.badRequest("Invalid event data. calendarId, title, startTime, and endTime are required.").toResponse();
    }
  }),
);

export { GET, POST };

import { createKeeperApi } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { database, oauthProviders, encryptionKey } from "../../../../context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  encryptionKey,
});

export const POST = withWideEvent(
  withV1Auth(async ({ params, userId }) => {
    const eventId = params.id;
    if (!eventId) {
      return ErrorResponse.badRequest("Event ID is required.").toResponse();
    }
    const result = await keeperApi.rsvpEvent(userId, eventId, "accepted");

    if (!result.success) {
      return ErrorResponse.badRequest(result.error ?? "Failed to accept event.").toResponse();
    }

    return Response.json({ status: "accepted" });
  }),
);

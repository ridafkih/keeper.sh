import { parseDateRangeParams } from "@/utils/date-range";
import { createKeeperApi } from "@/read-models";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { database, oauthProviders, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  encryptionKey,
});

const GET = withWideEvent(
  withV1Auth(async ({ request, params, userId }) => {
    const { calendarId } = params;
    if (!calendarId) {
      return ErrorResponse.badRequest("Calendar ID is required.").toResponse();
    }

    const url = new URL(request.url);
    const { from, to } = parseDateRangeParams(url);

    const invites = await keeperApi.getPendingInvites(
      userId,
      calendarId,
      from.toISOString(),
      to.toISOString(),
    );

    return Response.json(invites);
  }),
);

export { GET };

import { normalizeDateRange, parseDateRangeParams } from "@keeper.sh/calendar";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../../../utils/middleware";
import { ErrorResponse } from "../../../../../utils/responses";
import { database, oauthProviders, encryptionKey } from "../../../../../context";

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
    const { start, end } = normalizeDateRange(from, to);

    const invites = await keeperApi.getPendingInvites(
      userId,
      calendarId,
      start.toISOString(),
      end.toISOString(),
    );

    return Response.json(invites);
  }),
);

export { GET };

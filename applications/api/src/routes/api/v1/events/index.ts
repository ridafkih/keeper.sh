import { HTTP_STATUS } from "@keeper.sh/constants";
import { normalizeDateRange, parseDateRangeParams } from "@keeper.sh/calendar";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import type { KeeperEventFilters } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { respondWithLoggedError } from "../../../../utils/logging";
import { eventCreateBodySchema } from "../../../../utils/request-body";
import { database, oauthProviders, encryptionKey } from "../../../../context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  encryptionKey,
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

const GET = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const { from, to } = parseDateRangeParams(url);
    const { end, start } = normalizeDateRange(from, to);
    const shouldCount = url.searchParams.get("count") === "true";

    if (shouldCount) {
      const count = await keeperApi.getEventCount(userId, { from: start, to: end });
      return Response.json({ count });
    }

    const filters = parseEventFilters(url);
    const events = await keeperApi.getEventsInRange(
      userId,
      { from: start, to: end },
      filters,
    );
    return Response.json(events);
  }),
);

const POST = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const input = eventCreateBodySchema.assert(body);

      const result = await keeperApi.createEvent(userId, input);

      if (!result.success) {
        return ErrorResponse.badRequest(result.error ?? "Failed to create event.").toResponse();
      }

      return Response.json(result.event ?? { created: true }, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      return respondWithLoggedError(
        error,
        ErrorResponse.badRequest("Invalid event data. calendarId, title, startTime, and endTime are required.").toResponse(),
      );
    }
  }),
);

export { GET, POST };

import { type } from "arktype";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { RecurrenceMaterializationLimitError, isOAuthReauthRequiredError } from "@keeper.sh/calendar";
import {
  EventRangeValidationError,
  normalizeDateRange,
  parseDateRangeParams,
} from "@/utils/date-range";
import { createKeeperApi } from "@/read-models";
import type { KeeperEventFilters } from "@/types";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { eventCreateBodySchema, type EventCreateBody } from "@/utils/request-body";
import { database, oauthProviders, refreshLockStore, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, {
  oauthTokenRefresher: oauthProviders,
  refreshLockStore,
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
    try {
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
    } catch (error) {
      if (
        error instanceof RecurrenceMaterializationLimitError
        || error instanceof EventRangeValidationError
      ) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      throw error;
    }
  }),
);

const POST = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    // 1. Parse + validate the request body. Only genuine input problems map to 400.
    let timezone: string | undefined;
    let input: Omit<EventCreateBody, "timezone">;
    try {
      const body = await request.json();
      const parsed = eventCreateBodySchema(body);
      if (parsed instanceof type.errors) {
        return ErrorResponse.badRequest(
          "Invalid event data. calendarId, title, startTime, and endTime are required.",
        ).toResponse();
      }
      ({ timezone, ...input } = parsed);
    } catch {
      // request.json() threw = malformed / non-JSON body.
      return ErrorResponse.badRequest("Request body must be valid JSON.").toResponse();
    }

    // 2. Perform the create. Operational throws (e.g. an expired/revoked OAuth
    //    refresh token -> GoogleOAuthRefreshError/invalid_grant) must NOT be
    //    masked as a generic "invalid event data" 400 (MA-451/MA-423).
    try {
      const result = await keeperApi.createEvent(userId, { ...input, startTimeZone: timezone });

      if (!result.success) {
        return ErrorResponse.badRequest(result.error ?? "Failed to create event.").toResponse();
      }

      return Response.json(result.event ?? { created: true }, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      if (isOAuthReauthRequiredError(error)) {
        return ErrorResponse.unauthorized(
          "Calendar account requires reauthentication. Reconnect the Google/Microsoft account in keeper, then retry.",
        ).toResponse();
      }

      const message = error instanceof Error ? error.message : "Failed to create event.";
      return ErrorResponse.internal(message).toResponse();
    }
  }),
);

export { GET, POST };

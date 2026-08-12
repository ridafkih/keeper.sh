import { isCalendarId, setCalendarPaused } from "@/utils/calendar-pause";
import { calendarPausePatchBodySchema } from "@/utils/request-body";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { database } from "@/context";

const PATCH = withWideEvent(
  withV1Auth(async ({ request, params, userId }) => {
    const { calendarId } = params;
    if (!isCalendarId(calendarId)) {
      return ErrorResponse.badRequest("A valid calendar ID is required.").toResponse();
    }

    const body: unknown = await request.json().catch(() => null);
    if (!calendarPausePatchBodySchema.allows(body)) {
      return ErrorResponse.badRequest("'paused' must be a boolean.").toResponse();
    }

    const result = await setCalendarPaused(database, userId, calendarId, body.paused);
    if (!result) {
      return ErrorResponse.notFound().toResponse();
    }

    widelog.set("calendar.id", calendarId);
    widelog.set("calendar.paused", result.paused);

    return Response.json(result);
  }),
);

export { PATCH };

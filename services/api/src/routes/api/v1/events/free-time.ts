import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import { normalizeDateRange, parseDateRangeParams } from "@/utils/date-range";
import { DEFAULT_FREE_SLOTS, FreeTimeValidationError, parseWorkingHours } from "@/utils/free-time";
import { createKeeperApi } from "@/read-models";
import type { KeeperEventFilters, KeeperFreeTimeOptions } from "@/types";
import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { database } from "@/context";

const keeperApi = createKeeperApi(database);

const parseLimit = (limitParam: string | null): number => {
  if (!limitParam) {
    return DEFAULT_FREE_SLOTS;
  }
  return Number(limitParam);
};

const parseFreeTimeOptions = (url: URL): KeeperFreeTimeOptions => {
  const durationParam = url.searchParams.get("durationMinutes");
  if (!durationParam) {
    throw new FreeTimeValidationError("durationMinutes is required");
  }

  const timezone = url.searchParams.get("timezone");
  if (!timezone) {
    throw new FreeTimeValidationError("timezone is required");
  }

  return {
    durationMinutes: Number(durationParam),
    ignoreAllDayEvents: url.searchParams.get("ignoreAllDayEvents") === "true",
    limit: parseLimit(url.searchParams.get("limit")),
    timezone,
    workingHours: parseWorkingHours(
      url.searchParams.get("workingHoursStart"),
      url.searchParams.get("workingHoursEnd"),
      url.searchParams.get("workingDays"),
    ),
  };
};

const parseCalendarFilters = (url: URL): KeeperEventFilters | undefined => {
  const calendarId = url.searchParams.get("calendarId");
  if (!calendarId) {
    return;
  }
  return { calendarId: calendarId.split(",").filter(Boolean) };
};

const GET = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const url = new URL(request.url);

    try {
      const { from, to } = parseDateRangeParams(url);
      const { end, start } = normalizeDateRange(from, to);
      const options = parseFreeTimeOptions(url);

      const result = await keeperApi.findFreeTime(
        userId,
        { from: start, to: end },
        options,
        parseCalendarFilters(url),
      );

      return Response.json(result);
    } catch (error) {
      if (error instanceof RecurrenceMaterializationLimitError || error instanceof RangeError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      throw error;
    }
  }),
);

export { GET };

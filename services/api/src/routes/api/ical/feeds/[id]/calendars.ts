import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { calendarIdsBodySchema } from "@/utils/request-body";
import {
  FeedNotFoundError,
  UNOWNED_CALENDARS_ERROR_MESSAGE,
  getFeedCalendarIds,
  setFeedCalendars,
} from "@/utils/ical-feeds";

interface PutFeedCalendarsRouteContext {
  body: unknown;
  params: Record<string, string | undefined>;
  userId: string;
}

interface PutFeedCalendarsDependencies {
  setFeedCalendars: (
    userId: string,
    feedId: string,
    calendarIds: string[],
  ) => Promise<void>;
}

interface GetFeedCalendarsDependencies {
  getFeedCalendars: (userId: string, feedId: string) => Promise<string[] | null>;
}

const handlePutFeedCalendarsRoute = async (
  context: PutFeedCalendarsRouteContext,
  dependencies: PutFeedCalendarsDependencies,
): Promise<Response> => {
  const feedId = context.params.id;
  if (!feedId) {
    return ErrorResponse.badRequest("Feed ID is required.").toResponse();
  }

  if (!calendarIdsBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("calendarIds must be an array of calendar ids.").toResponse();
  }

  try {
    await dependencies.setFeedCalendars(context.userId, feedId, context.body.calendarIds);
    return Response.json({ calendarIds: context.body.calendarIds });
  } catch (error) {
    if (error instanceof FeedNotFoundError) {
      return ErrorResponse.notFound(error.message).toResponse();
    }
    if (error instanceof Error && error.message === UNOWNED_CALENDARS_ERROR_MESSAGE) {
      return ErrorResponse.notFound(UNOWNED_CALENDARS_ERROR_MESSAGE).toResponse();
    }
    throw error;
  }
};

const handleGetFeedCalendarsRoute = async (
  context: { params: Record<string, string | undefined>; userId: string },
  dependencies: GetFeedCalendarsDependencies,
): Promise<Response> => {
  const feedId = context.params.id;
  if (!feedId) {
    return ErrorResponse.badRequest("Feed ID is required.").toResponse();
  }

  const calendarIds = await dependencies.getFeedCalendars(context.userId, feedId);
  if (!calendarIds) {
    return ErrorResponse.notFound("Feed not found.").toResponse();
  }

  return Response.json({ calendarIds });
};

const GET = withWideEvent(
  withAuth(async ({ params, userId }) =>
    await handleGetFeedCalendarsRoute(
      { params, userId },
      { getFeedCalendars: getFeedCalendarIds },
    )),
);

const PUT = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    const payload = await request.json();

    return await handlePutFeedCalendarsRoute(
      { body: payload, params, userId },
      { setFeedCalendars },
    );
  }),
);

export { GET, PUT, handleGetFeedCalendarsRoute, handlePutFeedCalendarsRoute };

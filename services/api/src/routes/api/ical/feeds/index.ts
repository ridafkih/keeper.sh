import { icalFeedNameSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { ErrorResponse } from "@/utils/responses";
import { icalFeedCreateBodySchema } from "@/utils/request-body";
import {
  FEED_LIMIT_ERROR_MESSAGE,
  FeedLimitError,
  buildFeedListQuery,
  createFeed,
  ensureDefaultFeedForClient,
} from "@/utils/ical-feeds";
import { withFeedUrl } from "@/utils/ical-feed-url";


interface PostIcalFeedRouteContext {
  body: unknown;
  userId: string;
}

interface PostIcalFeedDependencies<TFeed> {
  createFeed: (userId: string, name: string) => Promise<TFeed>;
}

interface GetIcalFeedsDependencies<TFeed> {
  ensureDefaultFeed: (userId: string) => Promise<TFeed>;
  listFeeds: (userId: string) => Promise<TFeed[]>;
}

const handlePostIcalFeedRoute = async <TFeed>(
  context: PostIcalFeedRouteContext,
  dependencies: PostIcalFeedDependencies<TFeed>,
): Promise<Response> => {
  if (!icalFeedCreateBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("Feed name is required.").toResponse();
  }

  const name = context.body.name.trim();
  if (!icalFeedNameSchema.allows(name)) {
    return ErrorResponse.badRequest("Feed name cannot be empty.").toResponse();
  }

  try {
    const feed = await dependencies.createFeed(context.userId, name);
    return Response.json(feed, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    if (error instanceof FeedLimitError) {
      return ErrorResponse.paymentRequired(FEED_LIMIT_ERROR_MESSAGE).toResponse();
    }
    throw error;
  }
};

const handleGetIcalFeedsRoute = async <TFeed>(
  context: { userId: string },
  dependencies: GetIcalFeedsDependencies<TFeed>,
): Promise<Response> => {
  await dependencies.ensureDefaultFeed(context.userId);
  const feeds = await dependencies.listFeeds(context.userId);

  return Response.json(feeds);
};

const GET = withWideEvent(
  withAuth(async ({ userId }) => await handleGetIcalFeedsRoute(
    { userId },
    {
      ensureDefaultFeed: (resolvedUserId) =>
        ensureDefaultFeedForClient(database, resolvedUserId),
      listFeeds: async (resolvedUserId) => {
        const feeds = await buildFeedListQuery(database, resolvedUserId);
        return feeds.map((feed) => withFeedUrl(feed));
      },
    },
  )),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const payload = await request.json();

    return await handlePostIcalFeedRoute(
      { body: payload, userId },
      { createFeed: async (resolvedUserId, name) => withFeedUrl(await createFeed(resolvedUserId, name)) },
    );
  }),
);

export { GET, POST, handleGetIcalFeedsRoute, handlePostIcalFeedRoute };

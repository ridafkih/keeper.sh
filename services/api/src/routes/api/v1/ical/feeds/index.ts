import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import {
  buildFeedListQuery,
  ensureDefaultFeedForClient,
  getFeedCalendarIds,
} from "@/utils/ical-feeds";
import { withFeedUrl } from "@/utils/ical-feed-url";
import { handleGetIcalFeedsRoute, postIcalFeed } from "@/routes/api/ical/feeds";

const listFeedsWithCalendars = async (userId: string) => {
  const feeds = await buildFeedListQuery(database, userId);
  return Promise.all(feeds.map(async (feed) => ({
    ...withFeedUrl(feed),
    calendarIds: await getFeedCalendarIds(userId, feed.id) ?? [],
  })));
};

const GET = withWideEvent(
  withV1Auth(({ userId }) => handleGetIcalFeedsRoute(
    { userId },
    {
      ensureDefaultFeed: (resolvedUserId) => ensureDefaultFeedForClient(database, resolvedUserId),
      listFeeds: listFeedsWithCalendars,
    },
  )),
);

const POST = withWideEvent(withV1Auth(postIcalFeed));

export { GET, POST };

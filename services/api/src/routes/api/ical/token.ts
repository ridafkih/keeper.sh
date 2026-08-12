import { withAuth, withWideEvent } from "@/utils/middleware";
import { ensureDefaultFeedForClient } from "@/utils/ical-feeds";
import { buildFeedUrl } from "@/utils/ical-feed-url";
import { database } from "@/context";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const feed = await ensureDefaultFeedForClient(database, userId);
    return Response.json({ icalUrl: buildFeedUrl(feed.token), token: feed.token });
  }),
);

export { GET };

import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { ensureDefaultFeedForClient } from "@/utils/ical-feeds";
import { buildFeedUrl } from "@/utils/ical-feed-url";
import { database } from "@/context";

const GET = withWideEvent(
  withV1Auth(async ({ userId }) => {
    const feed = await ensureDefaultFeedForClient(database, userId);
    return Response.json({ url: buildFeedUrl(feed.token) });
  }),
);

export { GET };

import { baseUrl } from "@/context";

const buildFeedUrl = (token: string): string =>
  new URL(`/api/cal/${token}.ics`, baseUrl).toString();

const withFeedUrl = <TFeed extends { token: string }>(
  feed: TFeed,
): TFeed & { icalUrl: string } => ({
  ...feed,
  icalUrl: buildFeedUrl(feed.token),
});

export { buildFeedUrl, withFeedUrl };

import { withWideEvent } from "@/utils/middleware";
import { generateUserCalendar } from "@/utils/ical";
import { widelog } from "@/utils/logging";
import { ErrorResponse } from "@/utils/responses";

const ICS_EXTENSION_LENGTH = 4;
const NOT_MODIFIED_STATUS = 304;
const REDACTED_FEED_PATH = "/api/cal/:identifier";

/*
 * The feed is bounded only by its horizon, so a busy calendar makes a large
 * response and serialising it is the expensive part of this route. Subscribers
 * poll on a timer and most polls find nothing changed, so the validator is
 * resolved from a digest first and an unchanged feed never reads an event.
 *
 * no-cache keeps a subscriber revalidating every time rather than showing a
 * stale calendar, and private keeps a token-bearing URL out of shared caches.
 */
const CACHE_CONTROL = "private, no-cache";

const GET = withWideEvent(async ({ params, request }) => {
  const { identifier } = params;

  widelog.set("http.path", REDACTED_FEED_PATH);

  if (!identifier?.endsWith(".ics")) {
    return ErrorResponse.notFound().toResponse();
  }

  const startedAt = performance.now();
  const cleanIdentifier = identifier.slice(0, -ICS_EXTENSION_LENGTH);
  const feed = await generateUserCalendar(
    cleanIdentifier,
    request.headers.get("if-none-match"),
  );

  if (feed === null) {
    return ErrorResponse.notFound().toResponse();
  }

  widelog.set("feed.duration_ms", Math.round(performance.now() - startedAt));
  widelog.set("feed.not_modified", feed.body === null);

  if (feed.body === null) {
    return new Response(null, {
      status: NOT_MODIFIED_STATUS,
      headers: { "Cache-Control": CACHE_CONTROL, ETag: feed.etag },
    });
  }

  widelog.set("feed.event_count", feed.eventCount);
  widelog.set("feed.byte_size", Buffer.byteLength(feed.body, "utf8"));
  widelog.set("feed.withheld.working_location", feed.withheld.workingLocation);
  widelog.set("feed.withheld.working_elsewhere", feed.withheld.workingElsewhere);
  widelog.set("feed.withheld.all_day", feed.withheld.allDay);
  widelog.set("feed.withheld.focus_time", feed.withheld.focusTime);
  widelog.set("feed.withheld.out_of_office", feed.withheld.outOfOffice);

  return new Response(feed.body, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "text/calendar; charset=utf-8",
      ETag: feed.etag,
    },
  });
});

export { GET };

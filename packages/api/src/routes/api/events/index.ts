import { withAuth, withTracing } from "../../../utils/middleware";
import { getEventsInRange } from "../../../utils/events";

export const GET = withTracing(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const events = await getEventsInRange(userId, url);
    return Response.json(events);
  }),
);

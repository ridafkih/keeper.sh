import { withAuth, withWideEvent } from "../../../utils/middleware";
import { getEventsInRange } from "../../../utils/events";

export const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const events = await getEventsInRange(userId, url);
    return Response.json(events);
  }),
);

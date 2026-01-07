import { withAuth, withWideEvent } from "../../../utils/middleware";
import { listCalendarDestinations } from "../../../utils/destinations";

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await listCalendarDestinations(userId);
    return Response.json(destinations);
  }),
);

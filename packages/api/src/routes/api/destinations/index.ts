import { withAuth, withTracing } from "../../../utils/middleware";
import { listCalendarDestinations } from "../../../utils/destinations";

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const destinations = await listCalendarDestinations(userId);
    return Response.json(destinations);
  }),
);

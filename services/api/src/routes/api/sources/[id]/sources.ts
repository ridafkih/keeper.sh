import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import {
  getSourcesForDestination,
} from "@/utils/source-destination-mappings";
import {
  handleGetSourcesForDestinationRoute,
} from "./mapping-routes";

const GET = withWideEvent(
  withAuth(({ params, userId }) => handleGetSourcesForDestinationRoute(
      { params, userId },
      {
        destinationExists: async (userIdToCheck, destinationCalendarId) => {
          const [destination] = await database
            .select({ id: calendarsTable.id })
            .from(calendarsTable)
            .where(
              and(
                eq(calendarsTable.id, destinationCalendarId),
                eq(calendarsTable.userId, userIdToCheck),
              ),
            )
            .limit(1);

          return Boolean(destination);
        },
        getSourcesForDestination,
      },
    )),
);

export { GET };

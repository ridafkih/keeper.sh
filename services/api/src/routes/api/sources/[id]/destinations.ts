import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { database } from "../../../../context";
import {
  getDestinationsForSource,
  setDestinationsForSource,
} from "../../../../utils/source-destination-mappings";
import {
  handleGetSourceDestinationsRoute,
  handlePutSourceDestinationsRoute,
} from "./mapping-routes";

const GET = withWideEvent(
  withAuth(({ params, userId }) => handleGetSourceDestinationsRoute(
      { params, userId },
      {
        getDestinationsForSource,
        sourceExists: async (userIdToCheck, sourceCalendarId) => {
          const [source] = await database
            .select({ id: calendarsTable.id })
            .from(calendarsTable)
            .where(
              and(
                eq(calendarsTable.id, sourceCalendarId),
                eq(calendarsTable.userId, userIdToCheck),
              ),
            )
            .limit(1);

          return Boolean(source);
        },
      },
    )),
);

const PUT = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePutSourceDestinationsRoute(
      { body: payload, params, userId },
      { setDestinationsForSource },
    );
  }),
);

export { GET, PUT };

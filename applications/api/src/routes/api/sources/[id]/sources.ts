import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { database } from "../../../../context";
import {
  getSourcesForDestination,
  setSourcesForDestination,
} from "../../../../utils/source-destination-mappings";

export const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    const { id } = params;

    if (!id) {
      return ErrorResponse.badRequest("Destination ID is required").toResponse();
    }

    const [calendar] = await database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(and(eq(calendarsTable.id, id), eq(calendarsTable.userId, userId)))
      .limit(1);

    if (!calendar) {
      return ErrorResponse.notFound().toResponse();
    }

    const sourceIds = await getSourcesForDestination(id);
    return Response.json({ sourceIds });
  }),
);

export const PUT = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const { id } = params;

    if (!id) {
      return ErrorResponse.badRequest("Destination ID is required").toResponse();
    }

    const body = (await request.json()) as { calendarIds?: string[] };
    if (!Array.isArray(body.calendarIds)) {
      return ErrorResponse.badRequest("calendarIds array is required").toResponse();
    }

    await setSourcesForDestination(userId, id, body.calendarIds);
    return Response.json({ success: true });
  }),
);

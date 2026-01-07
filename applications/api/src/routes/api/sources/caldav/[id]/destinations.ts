import { updateSourceDestinationsSchema } from "@keeper.sh/data-schemas";
import { WideEvent } from "@keeper.sh/log";
import { withAuth, withWideEvent } from "../../../../../utils/middleware";
import { ErrorResponse } from "../../../../../utils/responses";
import { verifyCalDAVSourceOwnership } from "../../../../../utils/caldav-sources";
import { triggerDestinationSync } from "../../../../../utils/sync";
import {
  getDestinationsForSource,
  updateSourceMappings,
} from "../../../../../utils/source-destination-mappings";

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required").toResponse();
    }

    const isOwner = await verifyCalDAVSourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound().toResponse();
    }

    const destinationIds = await getDestinationsForSource(sourceId);
    return Response.json({ destinationIds });
  }),
);

const PUT = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required").toResponse();
    }

    const isOwner = await verifyCalDAVSourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound().toResponse();
    }

    try {
      const body = await request.json();
      const { destinationIds } = updateSourceDestinationsSchema.assert(body);

      await updateSourceMappings(userId, sourceId, destinationIds);
      triggerDestinationSync(userId);

      return Response.json({ success: true });
    } catch (error) {
      WideEvent.error(error);
      return ErrorResponse.badRequest("Invalid request body").toResponse();
    }
  }),
);

export { GET, PUT };

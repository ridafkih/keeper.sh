import { updateOAuthSourceDestinationsSchema } from "@keeper.sh/data-schemas";
import { getWideEvent } from "@keeper.sh/log";
import { withAuth, withWideEvent } from "../../../../../utils/middleware";
import { ErrorResponse } from "../../../../../utils/responses";
import {
  getDestinationsForOAuthSource,
  updateOAuthSourceMappings,
} from "../../../../../utils/oauth-source-destination-mappings";
import { verifyOAuthSourceOwnership } from "../../../../../utils/oauth-sources";
import { triggerDestinationSync } from "../../../../../utils/sync";

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required").toResponse();
    }

    const isOwner = await verifyOAuthSourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound().toResponse();
    }

    const destinationIds = await getDestinationsForOAuthSource(sourceId);
    return Response.json({ destinationIds });
  }),
);

const PUT = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required").toResponse();
    }

    const isOwner = await verifyOAuthSourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound().toResponse();
    }

    try {
      const body = await request.json();
      const { destinationIds } = updateOAuthSourceDestinationsSchema.assert(body);

      await updateOAuthSourceMappings(userId, sourceId, destinationIds);
      triggerDestinationSync(userId);

      return Response.json({ success: true });
    } catch (error) {
      getWideEvent()?.setError(error);
      return ErrorResponse.badRequest("Invalid request body").toResponse();
    }
  }),
);

export { GET, PUT };

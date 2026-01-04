import { updateSourceDestinationsSchema } from "@keeper.sh/data-schemas";
import { getWideEvent } from "@keeper.sh/log";
import { withTracing, withAuth } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  updateSourceMappings,
  getDestinationsForSource,
} from "../../../../utils/source-destination-mappings";
import { verifySourceOwnership } from "../../../../utils/sources";
import { triggerDestinationSync } from "../../../../utils/sync";

export const GET = withTracing(
  withAuth(async ({ params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required");
    }

    const isOwner = await verifySourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound();
    }

    const destinationIds = await getDestinationsForSource(sourceId);
    return Response.json({ destinationIds });
  }),
);

export const PUT = withTracing(
  withAuth(async ({ request, params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required");
    }

    const isOwner = await verifySourceOwnership(userId, sourceId);
    if (!isOwner) {
      return ErrorResponse.notFound();
    }

    try {
      const body = await request.json();
      const { destinationIds } = updateSourceDestinationsSchema.assert(body);

      await updateSourceMappings(userId, sourceId, destinationIds);
      triggerDestinationSync(userId);

      return Response.json({ success: true });
    } catch (error) {
      getWideEvent()?.setError(error);
      return ErrorResponse.badRequest("Invalid request body");
    }
  }),
);

import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { getDestinationsForSource } from "@/utils/source-destination-mappings";
import { verifyOAuthSourceOwnership } from "@/utils/oauth-sources";

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

    const destinationIds = await getDestinationsForSource(userId, sourceId);
    return Response.json({ destinationIds });
  }),
);

export { GET };

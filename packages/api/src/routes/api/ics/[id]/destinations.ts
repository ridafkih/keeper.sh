import { updateSourceDestinationsSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../../utils/middleware";
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
      return Response.json({ error: "Source ID is required" }, { status: 400 });
    }

    const isOwner = await verifySourceOwnership(userId, sourceId);
    if (!isOwner) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const destinationIds = await getDestinationsForSource(sourceId);
    return Response.json({ destinationIds });
  }),
);

export const PUT = withTracing(
  withAuth(async ({ request, params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return Response.json({ error: "Source ID is required" }, { status: 400 });
    }

    const isOwner = await verifySourceOwnership(userId, sourceId);
    if (!isOwner) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const body = await request.json();
      const { destinationIds } = updateSourceDestinationsSchema.assert(body);

      await updateSourceMappings(userId, sourceId, destinationIds);
      triggerDestinationSync(userId);

      return Response.json({ success: true });
    } catch {
      return Response.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
  }),
);

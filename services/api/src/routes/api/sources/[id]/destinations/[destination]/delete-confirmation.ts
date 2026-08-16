import { withAuth, withWideEvent } from "@/utils/middleware";
import { premiumService } from "@/context";
import { resolveDeleteConfirmation } from "@/utils/source-destination-mappings";
import { handlePatchDeleteConfirmationRoute } from "../../mapping-routes";

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePatchDeleteConfirmationRoute(
      {
        body: payload,
        params: { destinationId: params.destination ?? "", id: params.id ?? "" },
        userId,
      },
      {
        canUseTwoWaySync: (candidateUserId) =>
          premiumService.canUseTwoWaySync(candidateUserId),
        resolveDeleteConfirmation,
      },
    );
  }),
);

export { PATCH };

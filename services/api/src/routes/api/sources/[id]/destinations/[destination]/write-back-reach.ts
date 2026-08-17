import { withAuth, withWideEvent } from "@/utils/middleware";
import { premiumService } from "@/context";
import { setWriteBackReach } from "@/utils/source-destination-mappings";
import { handlePatchWriteBackReachRoute } from "../../mapping-routes";

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePatchWriteBackReachRoute(
      {
        body: payload,
        params: { destinationId: params.destination ?? "", id: params.id ?? "" },
        userId,
      },
      {
        canUseTwoWaySync: (candidateUserId) =>
          premiumService.canUseTwoWaySync(candidateUserId),
        setWriteBackReach,
      },
    );
  }),
);

export { PATCH };

import { withAuth, withWideEvent } from "@/utils/middleware";
import { premiumService } from "@/context";
import {
  setWriteBackMode,
  sourceSupportsWriteBack,
} from "@/utils/source-destination-mappings";
import { handlePatchMappingWriteBackModeRoute } from "../mapping-routes";

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePatchMappingWriteBackModeRoute(
      {
        body: payload,
        params: { destinationId: params.destination ?? "", id: params.id ?? "" },
        userId,
      },
      {
        canUseTwoWaySync: (candidateUserId) =>
          premiumService.canUseTwoWaySync(candidateUserId),
        setWriteBackMode,
        sourceSupportsWriteBack,
      },
    );
  }),
);

export { PATCH };

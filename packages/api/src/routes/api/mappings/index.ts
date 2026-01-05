import { withAuth, withWideEvent } from "../../../utils/middleware";
import { getUserMappings } from "../../../utils/source-destination-mappings";

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const mappings = await getUserMappings(userId);
    return Response.json(mappings);
  }),
);

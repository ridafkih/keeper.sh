import { withAuth, withTracing } from "../../../utils/middleware";
import { getUserMappings } from "../../../utils/source-destination-mappings";

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const mappings = await getUserMappings(userId);
    return Response.json(mappings);
  }),
);

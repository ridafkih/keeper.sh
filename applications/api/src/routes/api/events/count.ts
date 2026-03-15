import { createKeeperApi } from "../../../read-models";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperApi = createKeeperApi(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const count = await keeperApi.getEventCount(userId);
    return Response.json({ count });
  }),
);

import { withAuth, withWideEvent } from "@/utils/middleware";
import { createKeeperApi } from "@/read-models";
import { database, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, { encryptionKey });

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperApi.listDestinations(userId);
    return Response.json(destinations);
  }),
);

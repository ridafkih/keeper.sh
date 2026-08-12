import { createKeeperApi } from "@/read-models";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, { encryptionKey });

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperApi.getSyncStatuses(userId);
    return Response.json({ destinations });
  }),
);

export { GET };

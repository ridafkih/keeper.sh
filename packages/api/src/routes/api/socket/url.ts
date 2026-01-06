import env from "@keeper.sh/env/api";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/state";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const token = await generateSocketToken(userId);

    if (env.WEBSOCKET_URL) {
      const socketUrl = new URL(env.WEBSOCKET_URL);
      socketUrl.searchParams.set("token", token);
      return Response.json({ socketUrl: socketUrl.toString() });
    }

    return Response.json({ socketPath: `/api/socket?token=${token}` });
  }),
);

export { GET };

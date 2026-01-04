import env from "@keeper.sh/env/api";
import { withTracing, withAuth } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/socket-token";

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const token = generateSocketToken(userId);

    if (env.WEBSOCKET_URL) {
      const socketUrl = new URL(env.WEBSOCKET_URL);
      socketUrl.searchParams.set("token", token);
      return Response.json({ socketUrl: socketUrl.toString() });
    }

    return Response.json({ socketPath: `/api/socket?token=${token}` });
  }),
);

import env from "@keeper.sh/env/api";
import { withAuth, withTracing } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/socket-token";

const GET = withTracing(
  withAuth(({ userId }) => {
    const token = generateSocketToken(userId);

    if (env.WEBSOCKET_URL) {
      const socketUrl = new URL(env.WEBSOCKET_URL);
      socketUrl.searchParams.set("token", token);
      return Response.json({ socketUrl: socketUrl.toString() });
    }

    return Response.json({ socketPath: `/api/socket?token=${token}` });
  }),
);

export { GET };

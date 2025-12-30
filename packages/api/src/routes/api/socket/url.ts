import env from "@keeper.sh/env/api";
import { withTracing, withAuth } from "../../../utils/middleware";
import { socketTokens } from "../../../utils/state";

const TOKEN_TTL = 30_000;

const generateSocketToken = (userId: string): string => {
  const token = crypto.randomUUID();
  const timeout = setTimeout(() => socketTokens.delete(token), TOKEN_TTL);
  socketTokens.set(token, { userId, timeout });
  return token;
};

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

import { withTracing, withAuth } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/socket-token";

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const token = generateSocketToken(userId);
    return Response.json({ token });
  }),
);

import { withAuth, withTracing } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/socket-token";

export const GET = withTracing(
  withAuth(({ userId }) => {
    const token = generateSocketToken(userId);
    return Response.json({ token });
  }),
);

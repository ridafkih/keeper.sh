import { withAuth, withWideEvent } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/socket-token";

export const GET = withWideEvent(
  withAuth(({ userId }) => {
    const token = generateSocketToken(userId);
    return Response.json({ token });
  }),
);

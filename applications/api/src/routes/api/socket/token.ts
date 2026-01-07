import { withAuth, withWideEvent } from "../../../utils/middleware";
import { generateSocketToken } from "../../../utils/state";

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const token = await generateSocketToken(userId);
    return Response.json({ token });
  }),
);

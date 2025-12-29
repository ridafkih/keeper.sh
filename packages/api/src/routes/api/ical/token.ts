import env from "@keeper.sh/env/api";
import { withTracing, withAuth } from "../../../utils/middleware";
import { getUserIdentifierToken } from "../../../utils/user";
import { baseUrl } from "../../../context";

const getIcalUrl = (token: string): string | null => {
  const url = new URL(`/cal/${token}.ics`, baseUrl);
  return url.toString();
};

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const token = await getUserIdentifierToken(userId);
    const icalUrl = getIcalUrl(token);
    return Response.json({ token, icalUrl });
  }),
);

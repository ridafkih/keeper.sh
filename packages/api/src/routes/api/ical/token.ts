import env from "@keeper.sh/env/api";
import { withTracing, withAuth } from "../../../utils/middleware";
import { getUserIdentifierToken } from "../../../utils/user";

const getIcalUrl = (token: string): string | null => {
  if (!env.WEB_BASE_URL) return null;
  const url = new URL(`/cal/${token}.ics`, env.WEB_BASE_URL);
  return url.toString();
};

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const token = await getUserIdentifierToken(userId);
    const icalUrl = getIcalUrl(token);
    return Response.json({ token, icalUrl });
  }),
);

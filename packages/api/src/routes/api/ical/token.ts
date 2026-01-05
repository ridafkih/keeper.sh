import { withAuth, withTracing } from "../../../utils/middleware";
import { getUserIdentifierToken } from "../../../utils/user";
import { baseUrl } from "../../../context";

const getIcalUrl = (token: string): string | null => {
  const url = new URL(`/api/cal/${token}.ics`, baseUrl);
  return url.toString();
};

const GET = withTracing(
  withAuth(async ({ userId }) => {
    const token = await getUserIdentifierToken(userId);
    const icalUrl = getIcalUrl(token);
    return Response.json({ icalUrl, token });
  }),
);

export { GET };

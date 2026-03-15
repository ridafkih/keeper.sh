import { withV1Auth, withWideEvent } from "../../../../utils/middleware";
import { getUserIdentifierToken } from "../../../../utils/user";
import { baseUrl } from "../../../../context";

const getIcalUrl = (token: string): string => {
  const url = new URL(`/api/cal/${token}.ics`, baseUrl);
  return url.toString();
};

export const GET = withWideEvent(
  withV1Auth(async ({ userId }) => {
    const token = await getUserIdentifierToken(userId);
    const icalUrl = getIcalUrl(token);
    return Response.json({ url: icalUrl });
  }),
);

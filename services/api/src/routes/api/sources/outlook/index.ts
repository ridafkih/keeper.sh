import { createOAuthSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { oauthSourceFailureResponse } from "@/utils/oauth-source-failure-response";
import { getUserOAuthSources, createOAuthSource } from "@/utils/oauth-sources";

const OUTLOOK_PROVIDER = "outlook";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const sources = await getUserOAuthSources(userId, OUTLOOK_PROVIDER);
    return Response.json(sources);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    widelog.set("provider.name", "outlook");
    const body = await request.json();

    try {
      const { externalCalendarId, name, oauthSourceCredentialId } =
        createOAuthSourceSchema.assert(body);
      const source = await createOAuthSource({
        externalCalendarId,
        name,
        oauthCredentialId: oauthSourceCredentialId ?? "",
        provider: OUTLOOK_PROVIDER,
        userId,
      });
      return Response.json(source, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      return oauthSourceFailureResponse(error);
    }
  }),
);

export { GET, POST };

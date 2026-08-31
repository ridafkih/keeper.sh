import { createOAuthSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { oauthSourceFailureResponse } from "@/utils/oauth-source-failure-response";
import { getUserOAuthSources, createOAuthSource } from "@/utils/oauth-sources";
import { premiumService } from "@/context";

const GOOGLE_PROVIDER = "google";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const sources = await getUserOAuthSources(userId, GOOGLE_PROVIDER);
    return Response.json(sources);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    widelog.set("provider.name", "google");
    const body = await request.json();

    try {
      const {
        externalCalendarId,
        name,
        oauthSourceCredentialId,
        syncFocusTime,
        syncOutOfOffice,
      } = createOAuthSourceSchema.assert(body);

      const canFilter = await premiumService.canUseEventFilters(userId);

      const source = await createOAuthSource({
        ...(canFilter && !syncFocusTime && { excludeFocusTime: true }),
        ...(canFilter && !syncOutOfOffice && { excludeOutOfOffice: true }),
        externalCalendarId,
        name,
        oauthCredentialId: oauthSourceCredentialId ?? "",
        provider: GOOGLE_PROVIDER,
        userId,
      });

      return Response.json(source, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      return oauthSourceFailureResponse(error);
    }
  }),
);

export { GET, POST };

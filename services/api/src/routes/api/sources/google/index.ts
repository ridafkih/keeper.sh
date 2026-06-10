import { createOAuthSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import {
  OAuthSourceLimitError,
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  getUserOAuthSources,
  createOAuthSource,
} from "@/utils/oauth-sources";
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
      if (error instanceof OAuthSourceLimitError) {
        widelog.errorFields(error, { slug: "account-limit-reached" });
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof DestinationNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      if (error instanceof DestinationProviderMismatchError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      if (error instanceof DuplicateSourceError) {
        widelog.errorFields(error, { slug: "duplicate-source" });
        return Response.json({ error: error.message }, { status: HTTP_STATUS.CONFLICT });
      }

      return ErrorResponse.badRequest("Invalid request body").toResponse();
    }
  }),
);

export { GET, POST };

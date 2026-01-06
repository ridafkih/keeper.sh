import { createOAuthSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  OAuthSourceLimitError,
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  getUserOAuthSources,
  createOAuthSource,
} from "../../../../utils/oauth-sources";

const GOOGLE_PROVIDER = "google";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const sources = await getUserOAuthSources(userId, GOOGLE_PROVIDER);
    return Response.json(sources);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { destinationId, externalCalendarId, name } = createOAuthSourceSchema.assert(body);
      const source = await createOAuthSource(userId, destinationId, externalCalendarId, name, GOOGLE_PROVIDER);
      return Response.json(source, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      if (error instanceof OAuthSourceLimitError) {
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof DestinationNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      if (error instanceof DestinationProviderMismatchError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      if (error instanceof DuplicateSourceError) {
        return Response.json(
          { error: error.message },
          { status: HTTP_STATUS.CONFLICT },
        );
      }

      return ErrorResponse.badRequest("Invalid request body").toResponse();
    }
  }),
);

export { GET, POST };

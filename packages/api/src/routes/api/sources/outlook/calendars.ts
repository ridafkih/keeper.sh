import { listUserCalendars, CalendarListError } from "@keeper.sh/provider-outlook";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  getOAuthDestinationCredentials,
} from "../../../../utils/oauth-sources";
import { refreshMicrosoftAccessToken } from "../../../../utils/oauth-refresh";

const OUTLOOK_PROVIDER = "outlook";

interface CredentialsWithExpiry {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getValidAccessToken = async (
  destinationId: string,
  credentials: CredentialsWithExpiry,
): Promise<string> => {
  if (credentials.expiresAt < new Date()) {
    const refreshed = await refreshMicrosoftAccessToken(destinationId, credentials.refreshToken);
    const { accessToken } = refreshed;
    return accessToken;
  }
  const { accessToken } = credentials;
  return accessToken;
};

export const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const destinationId = url.searchParams.get("destinationId");

    if (!destinationId) {
      return ErrorResponse.badRequest("destinationId query parameter is required").toResponse();
    }

    try {
      const credentials = await getOAuthDestinationCredentials(userId, destinationId, OUTLOOK_PROVIDER);
      const accessToken = await getValidAccessToken(destinationId, credentials);

      const calendars = await listUserCalendars(accessToken);

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof DestinationNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      if (error instanceof DestinationProviderMismatchError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      if (error instanceof CalendarListError) {
        if (error.authRequired) {
          return Response.json(
            { authRequired: true, error: error.message },
            { status: HTTP_STATUS.UNAUTHORIZED },
          );
        }
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      throw error;
    }
  }),
);

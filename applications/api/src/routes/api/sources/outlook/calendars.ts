import { listUserCalendars, CalendarListError } from "@keeper.sh/provider-outlook";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
} from "../../../../utils/oauth-sources";
import {
  refreshMicrosoftAccessToken,
  refreshMicrosoftSourceAccessToken,
} from "../../../../utils/oauth-refresh";

const OUTLOOK_PROVIDER = "outlook";

interface CredentialsWithExpiry {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getValidDestinationAccessToken = async (
  destinationId: string,
  credentials: CredentialsWithExpiry,
): Promise<string> => {
  if (credentials.expiresAt < new Date()) {
    const refreshed = await refreshMicrosoftAccessToken(destinationId, credentials.refreshToken);
    return refreshed.accessToken;
  }
  return credentials.accessToken;
};

const getValidSourceAccessToken = async (
  credentialId: string,
  credentials: CredentialsWithExpiry,
): Promise<string> => {
  if (credentials.expiresAt < new Date()) {
    const refreshed = await refreshMicrosoftSourceAccessToken(credentialId, credentials.refreshToken);
    return refreshed.accessToken;
  }
  return credentials.accessToken;
};

const getAccessToken = async (
  userId: string,
  credentialId: string | null,
  destinationId: string | null,
): Promise<string> => {
  if (credentialId) {
    const credentials = await getOAuthSourceCredentials(userId, credentialId, OUTLOOK_PROVIDER);
    return getValidSourceAccessToken(credentialId, credentials);
  }

  if (destinationId) {
    const credentials = await getOAuthDestinationCredentials(userId, destinationId, OUTLOOK_PROVIDER);
    return getValidDestinationAccessToken(destinationId, credentials);
  }

  throw new Error("Either credentialId or destinationId is required");
};

export const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const destinationId = url.searchParams.get("destinationId");
    const credentialId = url.searchParams.get("credentialId");

    if (!destinationId && !credentialId) {
      return ErrorResponse.badRequest(
        "Either destinationId or credentialId query parameter is required",
      ).toResponse();
    }

    try {
      const accessToken = await getAccessToken(userId, credentialId, destinationId);
      const outlookCalendars = await listUserCalendars(accessToken);

      const calendars = outlookCalendars.map(({ id, name, isDefaultCalendar }) => ({
        id,
        summary: name,
        primary: isDefaultCalendar,
      }));

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof DestinationNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      if (error instanceof DestinationProviderMismatchError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      if (error instanceof SourceCredentialNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      if (error instanceof SourceCredentialProviderMismatchError) {
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

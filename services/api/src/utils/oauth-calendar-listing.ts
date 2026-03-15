import { HTTP_STATUS } from "@keeper.sh/constants";
import { ErrorResponse } from "./responses";
import { respondWithLoggedError } from "./logging";
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
} from "./oauth-sources";
import { oauthCalendarListingQuerySchema } from "./request-query";

interface CredentialsWithExpiry {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface RefreshTokenResult {
  accessToken: string;
}

interface CalendarListAuthError extends Error {
  authRequired: boolean;
}

interface OAuthCalendarListingOptions<TCalendar> {
  provider: string;
  listCalendars: (accessToken: string) => Promise<TCalendar[]>;
  normalizeCalendars: (calendars: TCalendar[]) => unknown[];
  refreshDestinationAccessToken: (
    destinationId: string,
    refreshToken: string,
  ) => Promise<RefreshTokenResult>;
  refreshSourceAccessToken: (
    credentialId: string,
    refreshToken: string,
  ) => Promise<RefreshTokenResult>;
  isCalendarListError: (error: unknown) => error is CalendarListAuthError;
}

type OAuthCalendarAccessOptions = Pick<
  OAuthCalendarListingOptions<never>,
  "provider" | "refreshDestinationAccessToken" | "refreshSourceAccessToken"
>;

const isExpired = (expiresAt: Date): boolean => expiresAt < new Date();

const getValidDestinationAccessToken = async (
  destinationId: string,
  credentials: CredentialsWithExpiry,
  refreshDestinationAccessToken: OAuthCalendarAccessOptions["refreshDestinationAccessToken"],
): Promise<string> => {
  if (isExpired(credentials.expiresAt)) {
    const refreshed = await refreshDestinationAccessToken(destinationId, credentials.refreshToken);
    return refreshed.accessToken;
  }
  return credentials.accessToken;
};

const getValidSourceAccessToken = async (
  credentialId: string,
  credentials: CredentialsWithExpiry,
  refreshSourceAccessToken: OAuthCalendarAccessOptions["refreshSourceAccessToken"],
): Promise<string> => {
  if (isExpired(credentials.expiresAt)) {
    const refreshed = await refreshSourceAccessToken(credentialId, credentials.refreshToken);
    return refreshed.accessToken;
  }
  return credentials.accessToken;
};

const resolveAccessToken = async (
  userId: string,
  credentialId: string | null,
  destinationId: string | null,
  options: OAuthCalendarAccessOptions,
): Promise<string> => {
  if (credentialId) {
    const credentials = await getOAuthSourceCredentials(userId, credentialId, options.provider);
    return getValidSourceAccessToken(
      credentialId,
      credentials,
      options.refreshSourceAccessToken,
    );
  }

  if (destinationId) {
    const credentials = await getOAuthDestinationCredentials(
      userId,
      destinationId,
      options.provider,
    );
    return getValidDestinationAccessToken(
      destinationId,
      credentials,
      options.refreshDestinationAccessToken,
    );
  }

  throw new Error("Either credentialId or destinationId is required");
};

const handleCalendarListError = (
  error: unknown,
  isCalendarListError: OAuthCalendarListingOptions<never>["isCalendarListError"],
): Response | null => {
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
  if (isCalendarListError(error)) {
    if (error.authRequired) {
      return Response.json(
        { authRequired: true, error: error.message },
        { status: HTTP_STATUS.UNAUTHORIZED },
      );
    }
    return ErrorResponse.badRequest(error.message).toResponse();
  }

  return null;
};

const listOAuthCalendars = async <TCalendar>(
  request: Request,
  userId: string,
  options: OAuthCalendarListingOptions<TCalendar>,
): Promise<Response> => {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const destinationId = url.searchParams.get("destinationId");
  const credentialId = url.searchParams.get("credentialId");

  if (!oauthCalendarListingQuerySchema.allows(query)) {
    return ErrorResponse.badRequest(
      "Either destinationId or credentialId query parameter is required",
    ).toResponse();
  }

  try {
    const accessToken = await resolveAccessToken(
      userId,
      credentialId,
      destinationId,
      options,
    );
    const calendars = await options.listCalendars(accessToken);

    return Response.json({ calendars: options.normalizeCalendars(calendars) });
  } catch (error) {
    const response = handleCalendarListError(error, options.isCalendarListError);
    if (response) {
      return respondWithLoggedError(error, response);
    }

    throw error;
  }
};

export { listOAuthCalendars };
export type { OAuthCalendarListingOptions };

import { HTTP_STATUS } from "@keeper.sh/constants";
import {
  calendarsTable,
  calendarAccountsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { ErrorResponse } from "./responses";
import { respondWithLoggedError, widelog } from "./logging";
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

interface NormalizedCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

interface OAuthCalendarListingOptions {
  provider: string;
  listCalendars: (accessToken: string) => Promise<NormalizedCalendar[]>;
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
  OAuthCalendarListingOptions,
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
  isCalendarListError: OAuthCalendarListingOptions["isCalendarListError"],
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

const getStoredCalendars = async (
  userId: string,
  credentialId: string | null,
  destinationId: string | null,
): Promise<NormalizedCalendar[]> => {
  const { database } = await import("@/context");

  if (credentialId) {
    const rows = await database
      .select({
        externalCalendarId: calendarsTable.externalCalendarId,
        name: calendarsTable.name,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarAccountsTable.oauthCredentialId, credentialId),
        ),
      );

    return rows
      .filter((row): row is typeof row & { externalCalendarId: string } => row.externalCalendarId !== null)
      .map((row) => ({ id: row.externalCalendarId, summary: row.name }));
  }

  if (destinationId) {
    const rows = await database
      .select({
        externalCalendarId: calendarsTable.externalCalendarId,
        name: calendarsTable.name,
      })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarsTable.accountId, destinationId),
        ),
      );

    return rows
      .filter((row): row is typeof row & { externalCalendarId: string } => row.externalCalendarId !== null)
      .map((row) => ({ id: row.externalCalendarId, summary: row.name }));
  }

  return [];
};

const listOAuthCalendars = async (
  request: Request,
  userId: string,
  options: OAuthCalendarListingOptions,
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

    try {
      const calendars = await options.listCalendars(accessToken);
      return Response.json({ calendars });
    } catch (listError) {
      if (options.isCalendarListError(listError) && listError.authRequired) {
        const calendars = await getStoredCalendars(userId, credentialId, destinationId);
        widelog.setFields({
          "calendar_list.fallback": true,
          "calendar_list.fallback_reason": "insufficient_scopes",
          "calendar_list.stored_count": calendars.length,
          "calendar_list.provider": options.provider,
        });
        return Response.json({ calendars });
      }
      throw listError;
    }
  } catch (error) {
    const response = handleCalendarListError(error, options.isCalendarListError);
    if (response) {
      return respondWithLoggedError(error, response);
    }

    throw error;
  }
};

export { listOAuthCalendars };
export type { OAuthCalendarListingOptions, NormalizedCalendar };

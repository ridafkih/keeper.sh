import { HTTP_STATUS } from "@keeper.sh/constants";
import { widelog } from "@/utils/logging";
import { ErrorResponse } from "@/utils/responses";
import { labelFailureResponse } from "@/utils/error-labelling";
import { RotatedTokenNotPersistedError } from "@keeper.sh/calendar/oauth-persistence";
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  OAuthSourceLimitError,
} from "@/utils/oauth-sources";

const ROTATED_TOKEN_LOST_MESSAGE =
  "The calendar connection could not be completed. Please reconnect the account.";

const oauthSourceFailureResponse = (error: unknown): Response => {
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
  if (error instanceof RotatedTokenNotPersistedError) {
    widelog.errorFields(error, { slug: "rotated-token-not-persisted" });
    return ErrorResponse.internal(ROTATED_TOKEN_LOST_MESSAGE).toResponse();
  }

  const databaseResponse = labelFailureResponse(error, { slug: "invalid-request-body" });
  if (databaseResponse) {
    return databaseResponse;
  }

  return ErrorResponse.badRequest("Invalid request body").toResponse();
};

export { oauthSourceFailureResponse };

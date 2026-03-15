import { withWideEvent } from "@/utils/middleware";
import { respondWithLoggedError } from "@/utils/logging";
import { ErrorResponse } from "@/utils/responses";
import {
  OAuthError,
  buildRedirectUrl,
  handleOAuthCallback,
  parseOAuthCallback,
} from "@/utils/oauth";
import { providerParamSchema } from "@/utils/request-query";
import { baseUrl } from "@/context";

const GET = withWideEvent(async ({ request, params }) => {
  if (!params.provider || !providerParamSchema.allows(params)) {
    return ErrorResponse.notFound().toResponse();
  }
  const { provider } = params;

  try {
    const callbackParams = parseOAuthCallback(request, provider);
    const { redirectUrl } = await handleOAuthCallback(callbackParams);
    return Response.redirect(redirectUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      return respondWithLoggedError(error, Response.redirect(error.redirectUrl.toString()));
    }

    const errorUrl = buildRedirectUrl("/dashboard/integrations", baseUrl, {
      destination: "error",
      error: "Failed to connect",
    });
    return respondWithLoggedError(error, Response.redirect(errorUrl.toString()));
  }
});

export { GET };

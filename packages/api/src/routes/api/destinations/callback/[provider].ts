import { withTracing } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  parseOAuthCallback,
  handleOAuthCallback,
  buildRedirectUrl,
  OAuthError,
} from "../../../../utils/oauth";

export const GET = withTracing(async ({ request, params }) => {
  const { provider } = params;

  if (!provider) {
    return ErrorResponse.notFound();
  }

  try {
    const callbackParams = parseOAuthCallback(request, provider);
    const { redirectUrl } = await handleOAuthCallback(callbackParams);
    return Response.redirect(redirectUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      return Response.redirect(error.redirectUrl.toString());
    }

    const errorUrl = buildRedirectUrl("/dashboard/integrations", {
      destination: "error",
      error: "Failed to connect",
    });
    return Response.redirect(errorUrl.toString());
  }
});

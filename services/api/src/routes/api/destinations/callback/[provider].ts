import { withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import {
  OAuthError,
  buildRedirectUrl,
  handleOAuthCallback,
  parseOAuthCallback,
} from "@/utils/oauth";
import { providerParamSchema } from "@/utils/request-query";
import { baseUrl } from "@/context";

const GET = withWideEvent(async ({ request, params }) => {
  widelog.set("operation.name", "GET /api/destinations/callback/:provider");
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
      widelog.errorFields(error, { slug: "oauth-callback-failed" });
      return Response.redirect(error.redirectUrl.toString());
    }

    widelog.errorFields(error, { slug: "unclassified" });
    const errorUrl = buildRedirectUrl("/dashboard/integrations", baseUrl, {
      destination: "error",
      error: "Failed to connect",
    });
    return Response.redirect(errorUrl.toString());
  }
});

export { GET };

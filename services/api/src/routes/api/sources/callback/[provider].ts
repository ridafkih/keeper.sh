import { withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { labelFailure } from "@/utils/error-labelling";
import { buildRedirectUrl, OAuthError } from "@/utils/oauth";
import { readOAuthProviderError } from "@/utils/oauth-provider-error";
import { asFailedResponse } from "@/utils/response-outcome";
import { oauthCallbackQuerySchema, providerParamSchema } from "@/utils/request-query";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  validateState,
} from "@/utils/destinations";
import {
  createOAuthSourceCredential,
  discardUnusedOAuthSourceCredential,
} from "@/utils/oauth-source-credentials";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { noteUserMilestone } from "@/utils/user-milestones";
import { resolveProviderFailureReason } from "@/utils/oauth-callback-failure";
import { baseUrl } from "@/context";
import env from "@/env";
import { buildMicrosoftAdminConsentUrl } from "@/utils/microsoft-admin-consent";
import type { OAuthConnectFailureReason } from "@keeper.sh/data-schemas";
import type { OAuthReturnTo } from "@keeper.sh/calendar";

const MS_PER_SECOND = 1000;
const MISSING_MAILBOX_ERROR_CODES = new Set(["MailboxNotEnabledForRESTAPI", "ResourceNotFound"]);

type CallbackFailureStage = "query" | "provider" | "state" | "token_exchange" | "userinfo" | "import";

const buildCallbackUrl = (provider: string): string =>
  new URL(`/api/sources/callback/${provider}`, baseUrl).toString();

const resolveApprovalUrl = (reason: OAuthConnectFailureReason): string | null => {
  if (reason !== "admin-approval-required" || !env.MICROSOFT_CLIENT_ID) {
    return null;
  }
  return buildMicrosoftAdminConsentUrl({
    callbackUrl: buildCallbackUrl("outlook"),
    clientId: env.MICROSOFT_CLIENT_ID,
  });
};

const buildErrorUrl = (reason: OAuthConnectFailureReason): URL => {
  const approvalUrl = resolveApprovalUrl(reason);
  return buildRedirectUrl("/dashboard/integrations", baseUrl, {
    reason,
    source: "error",
    ...(approvalUrl && { approvalUrl }),
  });
};

const readProviderErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !("providerErrorCode" in error)) {
    return null;
  }
  if (typeof error.providerErrorCode !== "string") {
    return null;
  }
  return error.providerErrorCode;
};

const resolveImportFailureReason = (providerErrorCode: string | null): OAuthConnectFailureReason => {
  if (providerErrorCode && MISSING_MAILBOX_ERROR_CODES.has(providerErrorCode)) {
    return "no-mailbox";
  }
  return "unknown";
};

const recordProviderError = (searchParams: URLSearchParams): OAuthConnectFailureReason => {
  const providerError = readOAuthProviderError(searchParams);
  if (providerError.error) {
    widelog.set("oauth.provider_error", providerError.error);
  }
  if (providerError.subcode) {
    widelog.set("oauth.provider_error_subcode", providerError.subcode);
  }
  if (providerError.code) {
    widelog.set("oauth.provider_error_code", providerError.code);
  }
  const reason = resolveProviderFailureReason({
    error: searchParams.get("error") ?? "",
    errorDescription: searchParams.get("error_description"),
  });
  widelog.set("oauth.failure_reason", reason);
  return reason;
};

const resolveCallbackState = async (state: string | null) => {
  if (!state) {
    return null;
  }
  try {
    return await validateState(state);
  } catch (error) {
    labelFailure(error, { slug: "unclassified" });
    return null;
  }
};

const redirectAsFailure = (stage: CallbackFailureStage, redirectUrl: URL): Response => {
  widelog.set("oauth.failure_stage", stage);
  return asFailedResponse(Response.redirect(redirectUrl.toString()));
};

const rejectCallback = (
  stage: CallbackFailureStage,
  message: string,
  errorUrl: URL = buildErrorUrl("unknown"),
): Response => {
  widelog.errorFields(new OAuthError(message, errorUrl), { slug: "oauth-callback-failed" });
  return redirectAsFailure(stage, errorUrl);
};

const importAccount = async (
  provider: string,
  userId: string,
  code: string,
  enterStage: (stage: CallbackFailureStage) => void,
): Promise<string> => {
  enterStage("token_exchange");
  const tokens = await exchangeCodeForTokens(provider, code, buildCallbackUrl(provider));

  if (!tokens.refresh_token) {
    throw new OAuthError("No refresh token", buildErrorUrl("unknown"));
  }

  enterStage("userinfo");
  const userInfo = await fetchUserInfo(provider, tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * MS_PER_SECOND);

  const credentialId = await createOAuthSourceCredential(userId, {
    accessToken: tokens.access_token,
    email: userInfo.email,
    expiresAt,
    provider,
    refreshToken: tokens.refresh_token,
  });

  enterStage("import");
  try {
    return await importOAuthAccountCalendars({
      accessToken: tokens.access_token,
      email: userInfo.email,
      oauthCredentialId: credentialId,
      provider,
      providerAccountId: userInfo.id,
      userId,
    });
  } catch (error) {
    await discardUnusedOAuthSourceCredential(credentialId);
    throw error;
  }
};

const RETURN_TO_PATHS: Record<OAuthReturnTo, { path: string; params: Record<string, string> }> = {
  onboarding: { params: { step: "connect" }, path: "/onboarding" },
};

const returnToUrl = (returnTo: OAuthReturnTo, params: Record<string, string>): URL => {
  const target = RETURN_TO_PATHS[returnTo];
  return buildRedirectUrl(target.path, baseUrl, { ...target.params, ...params });
};

const GET = withWideEvent(async ({ request, params }) => {
  if (!params.provider || !providerParamSchema.allows(params)) {
    return ErrorResponse.notFound().toResponse();
  }

  widelog.set("provider.name", params.provider);

  const { provider } = params;
  const url = new URL(request.url);
  const callbackQuery = Object.fromEntries(url.searchParams.entries());
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!oauthCallbackQuerySchema.allows(callbackQuery)) {
    return rejectCallback("query", "Invalid callback query parameters");
  }

  if (url.searchParams.has("admin_consent") && !url.searchParams.has("error")) {
    widelog.set("onboarding.admin_consent_completed", true);
    return Response.redirect(buildRedirectUrl(`/dashboard/connect/${provider}`, baseUrl).toString());
  }

  const validatedState = await resolveCallbackState(state);
  if (validatedState) {
    widelog.set("user.id", validatedState.userId);
    widelog.set("oauth.is_reconnect", Boolean(validatedState.sourceCredentialId));
  }

  // The state is read before the provider's error, so someone who cancels still lands where they started.
  const failureUrlFor = (fallback: URL): URL => {
    if (validatedState?.returnTo) {
      return returnToUrl(validatedState.returnTo, { error: "connect_failed" });
    }
    return fallback;
  };

  if (url.searchParams.has("error")) {
    const reason = recordProviderError(url.searchParams);
    const errorUrl = buildErrorUrl(reason);
    // Admin approval needs the instructions on the integrations page.
    if (reason === "admin-approval-required") {
      return rejectCallback("provider", "OAuth error from provider", errorUrl);
    }
    return rejectCallback("provider", "OAuth error from provider", failureUrlFor(errorUrl));
  }

  if (!code || !state) {
    return rejectCallback("query", "Missing code or state", failureUrlFor(buildErrorUrl("unknown")));
  }

  if (!validatedState) {
    return rejectCallback("state", "Invalid or expired state", buildErrorUrl("expired"));
  }

  const { userId, sourceCredentialId, returnTo } = validatedState;
  let stage: CallbackFailureStage = "token_exchange";

  try {
    const accountId = await importAccount(provider, userId, code, (nextStage) => {
      stage = nextStage;
    });
    noteUserMilestone(userId, "first_calendar_connected");

    /* A reconnect already has its calendars chosen, so only a first connection — which
       carries no source credential in its state — belongs in the setup sentence. */
    let successUrl = buildRedirectUrl("/dashboard/setup", baseUrl, { accountId });
    if (sourceCredentialId) {
      successUrl = buildRedirectUrl(`/dashboard/accounts/${accountId}`, baseUrl);
    } else if (returnTo) {
      successUrl = returnToUrl(returnTo, { accountId });
    }
    return Response.redirect(successUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      widelog.errorFields(error, { slug: "oauth-callback-failed" });
      return redirectAsFailure(stage, failureUrlFor(error.redirectUrl));
    }

    const providerErrorCode = readProviderErrorCode(error);
    if (providerErrorCode) {
      widelog.set("provider.error_code", providerErrorCode);
    }

    labelFailure(error, { slug: "unclassified" });
    return redirectAsFailure(stage, failureUrlFor(buildErrorUrl(resolveImportFailureReason(providerErrorCode))));
  }
});

export { GET };

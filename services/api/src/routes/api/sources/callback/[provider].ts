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
  reason: OAuthConnectFailureReason = "unknown",
): Response => {
  const errorUrl = buildErrorUrl(reason);
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

  if (url.searchParams.has("error")) {
    const reason = recordProviderError(url.searchParams);
    return rejectCallback("provider", "OAuth error from provider", reason);
  }

  if (!code || !state) {
    return rejectCallback("query", "Missing code or state");
  }

  if (!validatedState) {
    return rejectCallback("state", "Invalid or expired state", "expired");
  }

  const { userId, sourceCredentialId } = validatedState;
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
    }
    return Response.redirect(successUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      widelog.errorFields(error, { slug: "oauth-callback-failed" });
      return redirectAsFailure(stage, error.redirectUrl);
    }

    const providerErrorCode = readProviderErrorCode(error);
    if (providerErrorCode) {
      widelog.set("provider.error_code", providerErrorCode);
    }

    labelFailure(error, { slug: "unclassified" });
    return redirectAsFailure(stage, buildErrorUrl(resolveImportFailureReason(providerErrorCode)));
  }
});

export { GET };

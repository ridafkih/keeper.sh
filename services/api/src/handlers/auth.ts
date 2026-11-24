import { hasOAuthProviderApi, routeOidcCallbackRequest } from "@keeper.sh/auth";
import { loggedPathFor } from "@keeper.sh/otelemetry/tracing";
import { auth, authCapabilities, env } from "@/context";
import { prepareOAuthTokenRequest } from "./auth-oauth-resource";
import { context, widelog } from "@/utils/logging";
import { resolveOutcome } from "@/utils/middleware";
import { labelFailure } from "@/utils/error-labelling";
import { readAuthErrorDetail } from "@/utils/auth-error-detail";
import {
  describeCheckoutCreation,
  isCheckoutCreation,
  readCheckoutCreation,
} from "@/utils/billing-funnel";
import type { CheckoutCreation } from "@/utils/billing-funnel";
import { createSessionCookies } from "@/utils/session-cookies";
import type { SessionCookies } from "@/utils/session-cookies";

let sessionCookies: Promise<SessionCookies> | null = null;

const resolveSessionCookies = (): Promise<SessionCookies> => {
  sessionCookies ??= auth.$context.then(({ authCookies }) => createSessionCookies(authCookies));
  return sessionCookies;
};

const isUnauthenticatedRequest = (request: Request, cookies: SessionCookies): boolean => {
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.trim().length > 0) {
    return false;
  }

  return !cookies.hasSessionToken(request);
};

const prepareUnauthenticatedRegisterRequest = async (
  pathname: string,
  request: Request,
  cookies: SessionCookies,
): Promise<Request> => {
  if (pathname !== "/api/auth/oauth2/register") {
    return request;
  }

  if (request.method !== "POST") {
    return request;
  }

  if (!isUnauthenticatedRequest(request, cookies)) {
    return request;
  }

  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object") {
    return request;
  }

  const modified = { ...body, token_endpoint_auth_method: "none" };
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(modified),
  });
};

const processAuth = async (pathname: string, request: Request): Promise<Response> => {
  if (pathname === "/api/auth/capabilities") {
    return Response.json(authCapabilities);
  }

  if (hasOAuthProviderApi(auth.api)) {
    if (pathname === "/api/auth/.well-known/oauth-authorization-server") {
      return Response.json(
        await auth.api.getOAuthServerConfig({
          headers: request.headers,
        }),
      );
    }

    if (pathname === "/api/auth/.well-known/openid-configuration") {
      return Response.json(
        await auth.api.getOpenIdConfig({
          headers: request.headers,
        }),
      );
    }
  }

  const cookies = await resolveSessionCookies();
  const preparedRequest = await prepareUnauthenticatedRegisterRequest(pathname, request, cookies);
  const preparedTokenRequest = await prepareOAuthTokenRequest({
    mcpPublicUrl: env.MCP_PUBLIC_URL,
    pathname,
    request: preparedRequest,
  });

  const response = await auth.handler(routeOidcCallbackRequest(preparedTokenRequest.request));
  return cookies.finalizeAuthResponse(pathname, request, response);
};

const recordAuthErrorDetail = async (response: Response): Promise<void> => {
  const detail = await readAuthErrorDetail(response);
  if (!detail) {
    return;
  }
  if (detail.code) {
    widelog.set("auth.error_code", detail.code);
  }
  if (detail.description) {
    widelog.set("auth.error_description", detail.description);
  }
};

const readRequestJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
};

const readCheckoutCreationOf = async (
  pathname: string,
  request: Request,
): Promise<CheckoutCreation | null> => {
  if (!isCheckoutCreation(pathname, request.method)) {
    return null;
  }
  return readCheckoutCreation(await readRequestJson(request));
};

const handleAuthRequest = (pathname: string, request: Request): Promise<Response> =>
  context(async () => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const loggedPath = loggedPathFor(pathname);

    widelog.set("operation.name", `${request.method} ${loggedPath}`);
    widelog.set("operation.type", "auth");
    widelog.set("request.id", requestId);
    widelog.set("http.method", request.method);
    widelog.set("http.path", loggedPath);

    try {
      return await widelog.time.measure("duration_ms", async () => {
        const checkoutCreation = await readCheckoutCreationOf(pathname, request);
        const response = await processAuth(pathname, request);
        widelog.set("status_code", response.status);
        if (checkoutCreation) {
          widelog.setFields(describeCheckoutCreation(checkoutCreation, response.status));
        }
        widelog.set("outcome", resolveOutcome(response.status));
        await recordAuthErrorDetail(response);
        return response;
      });
    } catch (error) {
      widelog.set("status_code", 500);
      widelog.set("outcome", "error");
      labelFailure(error, { slug: "auth-request-failed" });
      throw error;
    } finally {
      widelog.flush();
    }
  });

export { handleAuthRequest };

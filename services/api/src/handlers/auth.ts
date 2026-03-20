import { hasOAuthProviderApi } from "@keeper.sh/auth";
import { auth, authCapabilities, env } from "@/context";
import { prepareOAuthTokenRequest } from "./auth-oauth-resource";
import { context, widelog } from "@/utils/logging";
import { resolveOutcome } from "@/utils/middleware";

const COMPANION_COOKIE_NAME = "keeper.has_session";
const COMPANION_COOKIE_SET = `${COMPANION_COOKIE_NAME}=1; Path=/; SameSite=Lax`;
const COMPANION_COOKIE_CLEAR = `${COMPANION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;

const isNullSession = (body: unknown): body is null | { session: null } => {
  if (body === null) {
    return true;
  }
  if (typeof body !== "object") {
    return false;
  }
  if (!("session" in body)) {
    return false;
  }
  return body.session === null;
};

const clearSessionCookies = (response: Response): Response => {
  const headers = new Headers(response.headers);
  const expiredCookie = "Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
  headers.append("Set-Cookie", `better-auth.session_token=; ${expiredCookie}`);
  headers.append("Set-Cookie", `better-auth.session_data=; ${expiredCookie}`);
  headers.append("Set-Cookie", COMPANION_COOKIE_CLEAR);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const hasSessionTokenSet = (response: Response): boolean => {
  const cookies = response.headers.getSetCookie();
  return cookies.some(
    (cookie) => cookie.includes("better-auth.session_token=") && !cookie.includes("Max-Age=0"),
  );
};

const hasSessionTokenCleared = (response: Response): boolean => {
  const cookies = response.headers.getSetCookie();
  return cookies.some(
    (cookie) => cookie.includes("better-auth.session_token=") && cookie.includes("Max-Age=0"),
  );
};

const withCompanionCookie = (response: Response, cookie: string): Response => {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const processAuthResponse = async (pathname: string, response: Response): Promise<Response> => {
  if (hasSessionTokenSet(response)) {
    return withCompanionCookie(response, COMPANION_COOKIE_SET);
  }

  if (hasSessionTokenCleared(response)) {
    return withCompanionCookie(response, COMPANION_COOKIE_CLEAR);
  }

  if (pathname !== "/api/auth/get-session") {
    return response;
  }

  const body = await response.clone().json();

  if (!isNullSession(body)) {
    return response;
  }

  return clearSessionCookies(response);
};

const isUnauthenticatedRequest = (request: Request): boolean => {
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.trim().length > 0) {
    return false;
  }

  const cookie = request.headers.get("cookie");
  if (cookie && cookie.includes("better-auth.session_token=")) {
    return false;
  }

  return true;
};

const prepareUnauthenticatedRegisterRequest = async (
  pathname: string,
  request: Request,
): Promise<Request> => {
  if (pathname !== "/api/auth/oauth2/register") {
    return request;
  }

  if (request.method !== "POST") {
    return request;
  }

  if (!isUnauthenticatedRequest(request)) {
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

  const preparedRequest = await prepareUnauthenticatedRegisterRequest(pathname, request);
  const preparedTokenRequest = await prepareOAuthTokenRequest({
    mcpPublicUrl: env.MCP_PUBLIC_URL,
    pathname,
    request: preparedRequest,
  });

  const response = await auth.handler(preparedTokenRequest.request);
  return processAuthResponse(pathname, response);
};

const handleAuthRequest = (pathname: string, request: Request): Promise<Response> =>
  context(async () => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    widelog.set("operation.name", `${request.method} ${pathname}`);
    widelog.set("operation.type", "auth");
    widelog.set("request.id", requestId);
    widelog.set("http.method", request.method);
    widelog.set("http.path", pathname);

    try {
      return widelog.time.measure("duration_ms", async () => {
        const response = await processAuth(pathname, request);
        widelog.set("status_code", response.status);
        widelog.set("outcome", resolveOutcome(response.status));
        return response;
      });
    } catch (error) {
      widelog.set("status_code", 500);
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: "auth-request-failed" });
      throw error;
    } finally {
      widelog.flush();
    }
  });

export { handleAuthRequest };

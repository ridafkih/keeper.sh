import type { MaybePromise } from "bun";
import { hasOAuthProviderApi } from "@keeper.sh/auth";
import { auth, authCapabilities, env } from "../context";
import { runApiWideEventContext, setWideEventFields, trackStatusError, widelog } from "../utils/logging";
import { prepareOAuthTokenRequest } from "./auth-oauth-resource";

const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_ERROR_THRESHOLD = 400;

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

const extractAuthContext = (request: Request, pathname: string): Record<string, unknown> => {
  const origin = request.headers.get("origin");
  const userAgent = request.headers.get("user-agent");
  return {
    http: {
      method: request.method,
      path: pathname,
      ...(origin && { origin }),
      ...(userAgent && { user_agent: userAgent }),
    },
    operation: {
      name: `${request.method} ${pathname}`,
      type: "auth",
    },
    request: {
      id: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  };
};

const handleAuthResponseStatus = (response: Response): void => {
  widelog.set("status_code", response.status);
  if (response.status >= HTTP_ERROR_THRESHOLD) {
    widelog.set("outcome", "error");
  } else {
    widelog.set("outcome", "success");
  }
  if (response.status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(response.status, "AuthError");
  }
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

const handleAuthRequest = (pathname: string, request: Request): MaybePromise<Response> =>
  runApiWideEventContext(async () => {
    setWideEventFields(extractAuthContext(request, pathname));
    try {
      return await widelog.time.measure("duration_ms", async () => {
        if (pathname === "/api/auth/capabilities") {
          const response = Response.json(authCapabilities);
          handleAuthResponseStatus(response);
          return response;
        }

        if (hasOAuthProviderApi(auth.api)) {
          if (pathname === "/api/auth/.well-known/oauth-authorization-server") {
            const response = Response.json(
              await auth.api.getOAuthServerConfig({
                headers: request.headers,
              }),
            );
            handleAuthResponseStatus(response);
            return response;
          }

          if (pathname === "/api/auth/.well-known/openid-configuration") {
            const response = Response.json(
              await auth.api.getOpenIdConfig({
                headers: request.headers,
              }),
            );
            handleAuthResponseStatus(response);
            return response;
          }
        }

        try {
          const preparedTokenRequest = await prepareOAuthTokenRequest({
            mcpPublicUrl: env.MCP_PUBLIC_URL,
            pathname,
            request,
          });

          if (preparedTokenRequest.mcpResourceInjected) {
            widelog.set("oauth.mcp_resource.injected", true);
            widelog.set("oauth.mcp_resource.value", preparedTokenRequest.mcpResourceUrl);
          }

          const response = await auth.handler(preparedTokenRequest.request);
          handleAuthResponseStatus(response);
          return await processAuthResponse(pathname, response);
        } catch (error) {
          widelog.set("status_code", HTTP_INTERNAL_SERVER_ERROR);
          widelog.set("outcome", "error");
          widelog.errorFields(error);
          throw error;
        }
      });
    } finally {
      widelog.flush();
    }
  });

export { handleAuthRequest };

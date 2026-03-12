import type { MaybePromise } from "bun";
import { hasOAuthProviderApi } from "@keeper.sh/auth";
import { auth, authCapabilities } from "../context";
import { widelog, trackStatusError } from "../utils/logging";

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
    "http.method": request.method,
    "http.path": pathname,
    "operation.name": `${request.method} ${pathname}`,
    "operation.type": "auth",
    ...(origin && { "http.origin": origin }),
    ...(userAgent && { "http.user_agent": userAgent }),
  };
};

const handleAuthResponseStatus = (response: Response): void => {
  widelog.set("http.status_code", response.status);
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
  widelog.context(async () => {
    const authContext = extractAuthContext(request, pathname);
    for (const [key, value] of Object.entries(authContext)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        widelog.set(key, value);
      }
    }
    widelog.time.start("duration_ms");
    try {
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

      const response = await auth.handler(request);
      handleAuthResponseStatus(response);
      return await processAuthResponse(pathname, response);
    } catch (error) {
      widelog.set("http.status_code", HTTP_INTERNAL_SERVER_ERROR);
      throw error;
    } finally {
      widelog.time.stop("duration_ms");
      widelog.flush();
    }
  });

export { handleAuthRequest };

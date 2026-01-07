import type { MaybePromise } from "bun";
import { WideEvent } from "@keeper.sh/log";
import { auth } from "../context";

const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_ERROR_THRESHOLD = 400;

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

const handleAuthResponseStatus = (event: WideEvent, response: Response): void => {
  event.set({ "http.status_code": response.status });
  if (response.status >= HTTP_ERROR_THRESHOLD) {
    event.set({
      "error.occurred": true,
      "error.message": `HTTP ${response.status}`,
      "error.type": "AuthError",
    });
  }
};

const processAuthResponse = async (pathname: string, response: Response): Promise<Response> => {
  if (pathname !== "/api/auth/get-session") {
    return response;
  }

  const body = await response.clone().json();

  if (!isNullSession(body)) {
    return response;
  }

  return clearSessionCookies(response);
};

const handleAuthRequest = (pathname: string, request: Request): MaybePromise<Response> => {
  const event = new WideEvent();
  event.set(extractAuthContext(request, pathname));

  return event.run(async () => {
    try {
      const response = await auth.handler(request);
      handleAuthResponseStatus(event, response);
      return processAuthResponse(pathname, response);
    } catch (error) {
      event.addError(error);
      event.set({ "http.status_code": HTTP_INTERNAL_SERVER_ERROR });
      throw error;
    } finally {
      event.emit();
    }
  });
};

export { handleAuthRequest };

import type { MaybePromise } from "bun";
import { trustedOrigins, baseUrl } from "../context";

const CORS_MAX_AGE_SECONDS = 86_400;
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const EMPTY_ORIGINS_COUNT = 0;

type FetchHandler = (request: Request) => MaybePromise<Response | undefined>;

const corsHeaders = (origin: string): Record<string, string> => ({
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": origin,
});

const withCors = (handler: FetchHandler): FetchHandler => {
  const allowedOrigins = [...trustedOrigins];
  if (baseUrl) {
    allowedOrigins.push(baseUrl);
  }

  const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) {
      return false;
    }
    if (allowedOrigins.length === EMPTY_ORIGINS_COUNT) {
      return false;
    }
    return allowedOrigins.includes(origin);
  };

  return async (request): Promise<Response | undefined> => {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (!origin) {
        return new Response(null, { status: HTTP_NO_CONTENT });
      }
      if (!isOriginAllowed(origin)) {
        return new Response(null, { status: HTTP_FORBIDDEN });
      }

      return new Response(null, {
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
        },
        status: HTTP_NO_CONTENT,
      });
    }

    const response = await handler(request);

    if (!response || !origin || !isOriginAllowed(origin)) {
      return response;
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
};

export { withCors };

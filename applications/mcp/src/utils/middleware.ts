import {
  trackStatusError,
  widelog,
} from "./logging";

const HTTP_ERROR_THRESHOLD = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;

type RouteHandler = (request: Request) => Response | Promise<Response>;

const extractHttpContext = (request: Request): Record<string, string> => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const userAgent = request.headers.get("user-agent");
  const fields: Record<string, string> = {
    "http.method": request.method,
    "http.path": url.pathname,
    "operation.name": `${request.method} ${url.pathname}`,
    "operation.type": "http",
  };
  if (origin) {
    fields["http.origin"] = origin;
  }
  if (userAgent) {
    fields["http.user_agent"] = userAgent;
  }
  return fields;
};

const handleResponseStatus = (status: number): void => {
  widelog.set("http.status_code", status);
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const withWideEvent =
  (handler: (request: Request) => Response | Promise<Response>): RouteHandler =>
  (request) =>
    widelog.context(async () => {
      const httpContext = extractHttpContext(request);
      for (const [key, value] of Object.entries(httpContext)) {
        widelog.set(key, value);
      }
      try {
        const response = await handler(request);
        handleResponseStatus(response.status);
        return response;
      } catch (error) {
        widelog.set("http.status_code", HTTP_INTERNAL_SERVER_ERROR);
        widelog.errorFields(error);
        throw error;
      } finally {
        widelog.flush();
      }
    });

export { withWideEvent };
export type { RouteHandler };

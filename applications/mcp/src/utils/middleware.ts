import {
  reportError,
  runWideEvent,
  setLogFields,
  trackStatusError,
} from "./logging";

const HTTP_ERROR_THRESHOLD = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;

type RouteHandler = (request: Request) => Response | Promise<Response>;

const extractHttpContext = (request: Request): Record<string, unknown> => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const userAgent = request.headers.get("user-agent");
  return {
    "http.method": request.method,
    "http.path": url.pathname,
    "operation.name": `${request.method} ${url.pathname}`,
    "operation.type": "http",
    ...(origin && { "http.origin": origin }),
    ...(userAgent && { "http.user_agent": userAgent }),
  };
};

const handleResponseStatus = (status: number): void => {
  setLogFields({ "http.status_code": status });
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const withWideEvent =
  (handler: (request: Request) => Response | Promise<Response>): RouteHandler =>
  (request) =>
    runWideEvent(extractHttpContext(request), async () => {
      try {
        const response = await handler(request);
        handleResponseStatus(response.status);
        return response;
      } catch (error) {
        setLogFields({ "http.status_code": HTTP_INTERNAL_SERVER_ERROR });
        reportError(error);
        throw error;
      }
    });

export { withWideEvent };
export type { RouteHandler };

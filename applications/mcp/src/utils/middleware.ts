import {
  runMcpWideEventContext,
  setWideEventFields,
  trackStatusError,
  widelog,
} from "./logging";

const HTTP_ERROR_THRESHOLD = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;

type RouteHandler = (request: Request) => Response | Promise<Response>;

const extractHttpContext = (request: Request): Record<string, unknown> => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const userAgent = request.headers.get("user-agent");
  const fields: Record<string, unknown> = {
    http: {
      method: request.method,
      path: url.pathname,
      ...(origin && { origin }),
      ...(userAgent && { user_agent: userAgent }),
    },
    operation: {
      name: `${request.method} ${url.pathname}`,
      type: "http",
    },
    request: {
      id: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  };
  return fields;
};

const mapHttpStatusToOutcome = (status: number): "success" | "error" =>
  status >= HTTP_ERROR_THRESHOLD ? "error" : "success";

const handleResponseStatus = (status: number): void => {
  widelog.set("status_code", status);
  widelog.set("outcome", mapHttpStatusToOutcome(status));
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const withWideEvent =
  (handler: (request: Request) => Response | Promise<Response>): RouteHandler =>
  (request) =>
    runMcpWideEventContext(async () => {
      setWideEventFields(extractHttpContext(request));
      try {
        return await widelog.time.measure("duration_ms", async () => {
          try {
            const response = await handler(request);
            handleResponseStatus(response.status);
            return response;
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

export { withWideEvent };
export type { RouteHandler };

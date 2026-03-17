import { context, widelog } from "./logging";

type RouteHandler = (request: Request) => Response | Promise<Response>;

const resolveOutcome = (statusCode: number): "success" | "error" => {
  if (statusCode >= 400) {
    return "error";
  }
  return "success";
};

const withWideEvent =
  (handler: (request: Request) => Response | Promise<Response>): RouteHandler =>
  (request) =>
    context(async () => {
      const url = new URL(request.url);
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

      widelog.set("operation.name", `${request.method} ${url.pathname}`);
      widelog.set("operation.type", "http");
      widelog.set("request.id", requestId);
      widelog.set("http.method", request.method);
      widelog.set("http.path", url.pathname);

      const userAgent = request.headers.get("user-agent");
      if (userAgent) {
        widelog.set("http.user_agent", userAgent);
      }

      try {
        return await widelog.time.measure("duration_ms", async () => {
          const response = await handler(request);
          widelog.set("status_code", response.status);
          widelog.set("outcome", resolveOutcome(response.status));
          return response;
        });
      } catch (error) {
        widelog.set("status_code", 500);
        widelog.set("outcome", "error");
        widelog.errorFields(error, { slug: "unclassified" });
        throw error;
      } finally {
        widelog.flush();
      }
    });

export { withWideEvent };
export type { RouteHandler };

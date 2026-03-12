import { widelogger } from "widelogger";
import type { ServerConfig } from "./types";

const loggerServiceName = "@keeper.sh/canary-web";

const { destroy: destroyWideLogger, widelog } = widelogger({
  defaultEventName: "wide_event",
  environment: process.env.ENV ?? process.env.NODE_ENV,
  service: loggerServiceName,
});

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = Reflect.get(error, "name");
  return name === "AbortError";
}

export async function emitLifecycleWideEvent(
  operationName: string,
  outcome: "success" | "error",
  config: ServerConfig,
): Promise<void> {
  await widelog.context(async () => {
    const now = Date.now();
    widelog.set("operation.name", operationName);
    widelog.set("operation.type", "lifecycle");
    widelog.set("request.timing.start", now);
    widelog.set("request.timing.end", now);
    widelog.set("request.duration.ms", 0);
    widelog.set("server.port", config.serverPort);
    widelog.set("server.environment", config.environment);
    widelog.set("outcome", outcome);
    widelog.flush();
  });
}

export async function handleWithWideLogging(
  request: Request,
  config: ServerConfig,
  handleRequest: (request: Request) => Promise<Response>,
): Promise<Response> {
  return widelog.context(async () => {
    const requestUrl = new URL(request.url);
    const requestStart = Date.now();
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    widelog.set("operation.name", `${request.method} ${requestUrl.pathname}`);
    widelog.set("operation.type", "http");
    widelog.set("request.id", requestId);
    widelog.set("request.timing.start", requestStart);
    widelog.set("http.method", request.method);
    widelog.set("http.path", requestUrl.pathname);
    widelog.set("server.port", config.serverPort);
    widelog.set("server.environment", config.environment);

    const userAgent = request.headers.get("user-agent");
    if (userAgent) {
      widelog.set("http.user_agent", userAgent);
    }

    try {
      const response = await handleRequest(request);
      widelog.set("http.status_code", response.status);
      if (response.status >= 500) {
        widelog.set("outcome", "error");
      } else {
        widelog.set("outcome", "success");
      }
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        widelog.set("http.status_code", 499);
        widelog.set("outcome", "cancelled");
        return new Response(null, { status: 499, statusText: "Client Closed Request" });
      }

      widelog.set("http.status_code", 500);
      widelog.set("outcome", "error");
      widelog.errorFields(error, { includeStack: false });
      return new Response("Internal Server Error", { status: 500 });
    } finally {
      const requestEnd = Date.now();
      widelog.set("request.timing.end", requestEnd);
      widelog.set("request.duration.ms", requestEnd - requestStart);
      widelog.flush();
    }
  });
}

export { destroyWideLogger };

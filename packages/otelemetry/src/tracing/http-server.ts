import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { withSpanInContext } from "./spans";
import { contextFromHeaders } from "./trace-context";

const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_SERVER_ERROR = 500;

interface IncomingRequestOptions {
  trustIncomingTraceContext: boolean;
}

const recordResponse = (response: Response | undefined) => {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  const statusCode = response?.status ?? HTTP_SWITCHING_PROTOCOLS;
  span.setAttribute("http.response.status_code", statusCode);
  if (statusCode >= HTTP_SERVER_ERROR) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
};

const parentContextFor = (request: Request, options: IncomingRequestOptions) => {
  if (options.trustIncomingTraceContext) {
    return contextFromHeaders(request.headers);
  }
  return ROOT_CONTEXT;
};

const traceIncomingRequest = (
  request: Request,
  options: IncomingRequestOptions,
  handle: () => Promise<Response | undefined>,
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  const parentContext = parentContextFor(request, options);
  const attributes = {
    "http.request.method": request.method,
    "url.path": url.pathname,
    "url.scheme": url.protocol.replace(":", ""),
    ...(request.headers.has("user-agent") && { "user_agent.original": request.headers.get("user-agent") ?? "" }),
  };

  return withSpanInContext(request.method, { kind: SpanKind.SERVER, attributes }, parentContext, async () => {
    const response = await handle();
    recordResponse(response);
    return response;
  });
};

const nameRequestRoute = (method: string, route: string) => {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  span.updateName(`${method} ${route}`);
  span.setAttribute("http.route", route);
};

export { nameRequestRoute, traceIncomingRequest };
export type { IncomingRequestOptions };

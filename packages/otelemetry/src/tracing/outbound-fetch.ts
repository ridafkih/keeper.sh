import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { withSpan } from "./spans";
import { injectIntoHeaders } from "./trace-context";

const HTTP_CLIENT_ERROR = 400;

type Fetch = typeof globalThis.fetch;
type FetchInput = Parameters<Fetch>[0];
type FetchInit = Parameters<Fetch>[1];

const requestUrlOf = (input: FetchInput): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const requestMethodOf = (input: FetchInput, init: FetchInit): string => {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
};

const requestHeadersOf = (input: FetchInput, init: FetchInit): Headers => {
  const headers = new Headers();
  if (input instanceof Request) {
    for (const [key, value] of input.headers.entries()) {
      headers.set(key, value);
    }
  }
  for (const [key, value] of new Headers(init?.headers).entries()) {
    headers.set(key, value);
  }
  return headers;
};

const serverAddressOf = (url: URL, init: FetchInit): string =>
  new Headers(init?.headers).get("host")?.split(":")[0] ?? url.hostname;

const defaultPortOf = (url: URL): number => {
  if (url.protocol === "https:") {
    return 443;
  }
  return 80;
};

const withTraceHeaders = (headers: Headers): Headers => {
  injectIntoHeaders(headers);
  return headers;
};

const outgoingInitFor = (
  input: FetchInput,
  init: FetchInit,
  url: URL,
  propagateToOrigins: Set<string>,
): FetchInit => {
  if (!propagateToOrigins.has(url.origin)) {
    return init;
  }
  return { ...init, headers: withTraceHeaders(requestHeadersOf(input, init)) };
};

const isTraceable = () => {
  const active = context.active();
  return !isTracingSuppressed(active) && trace.getSpan(active)?.isRecording() === true;
};

const createTracedFetch = (fetchWithoutTracing: Fetch, propagateToOrigins: Set<string>): Fetch => {
  const tracedFetch = (input: FetchInput, init?: FetchInit): Promise<Response> => {
    if (!isTraceable()) {
      return fetchWithoutTracing(input, init);
    }
    const url = requestUrlOf(input);
    const method = requestMethodOf(input, init);
    const serverAddress = serverAddressOf(url, init);
    const attributes = {
      "http.request.method": method,
      "server.address": serverAddress,
      "server.port": Number(url.port) || defaultPortOf(url),
      "url.scheme": url.protocol.replace(":", ""),
    };

    return withSpan(`${method} ${serverAddress}`, { kind: SpanKind.CLIENT, attributes }, async () => {
      const span = trace.getActiveSpan();
      const response = await fetchWithoutTracing(input, outgoingInitFor(input, init, url, propagateToOrigins));
      span?.setAttribute("http.response.status_code", response.status);
      if (response.status >= HTTP_CLIENT_ERROR) {
        span?.setStatus({ code: SpanStatusCode.ERROR });
      }
      return response;
    });
  };

  return Object.assign(tracedFetch, { preconnect: fetchWithoutTracing.preconnect });
};

const instrumentGlobalFetch = (propagateToOrigins: string[]) => {
  const fetchWithoutTracing = globalThis.fetch;
  const origins = new Set(propagateToOrigins.map((origin) => new URL(origin).origin));
  globalThis.fetch = createTracedFetch(fetchWithoutTracing, origins);
  return () => {
    globalThis.fetch = fetchWithoutTracing;
  };
};

export { createTracedFetch, instrumentGlobalFetch };
